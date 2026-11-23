using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using static NexoCrm.CrmRules;

namespace NexoCrm;

public static class RelationshipEndpoints
{
    public static void Map(WebApplication app)
    {
        var routes = app.Module("clientes");
        routes.MapGet("", List);
        routes.MapGet("/directorio", Directory);
        routes.MapGet("/oportunidades/tablero", Pipeline);
        routes.MapPatch("/oportunidades/{id:int}/etapa", MoveOpportunity);
        routes.MapGet("/responsables", async (CrmDb db) => Results.Ok(await db.Accounts
            .Where(x => x.Active && Commercial.Contains(x.Role)).OrderBy(x => x.Name)
            .Select(x => new { x.Id, x.Name }).ToListAsync())).RequireAuthorization(policy => policy.RequireRole(Managers));
        routes.MapPost("", (PartyInput input, ClaimsPrincipal user, CrmDb db) => Save(null, input, user, db));
        routes.MapPut("/{id:int}", (int id, PartyInput input, ClaimsPrincipal user, CrmDb db) => Save(id, input, user, db));
        routes.MapGet("/{id:int}/detalle", Details);
        routes.MapPost("/{id:int}/convertir", Convert);
        routes.MapPost("/{id:int}/contactos", AddContact);
        routes.MapPost("/{id:int}/oportunidades", (int id, OpportunityInput input, ClaimsPrincipal user, CrmDb db) =>
            SaveOpportunity(id, null, input, user, db));
        routes.MapPut("/{id:int}/oportunidades/{opportunityId:int}", (int id, int opportunityId, OpportunityInput input,
            ClaimsPrincipal user, CrmDb db) => SaveOpportunity(id, opportunityId, input, user, db));
    }

    private static async Task<IResult> List(string? q, string? tipo, ClaimsPrincipal user, CrmDb db)
    {
        var query = db.Parties.AsNoTracking();
        if (!user.IsManager()) query = query.Where(x => x.OwnerId == user.UserId());
        if (tipo is "Cliente" or "Prospecto") query = query.Where(x => x.Kind == tipo);
        if (!string.IsNullOrWhiteSpace(q))
        {
            var search = q.Trim().ToLowerInvariant();
            query = query.Where(x => x.Name.ToLower().Contains(search) || x.Contact.ToLower().Contains(search)
                || x.Email.ToLower().Contains(search));
        }
        return Results.Ok(await query.OrderBy(x => x.Name).ToListAsync());
    }

    private static async Task<IResult> Directory(ClaimsPrincipal user, CrmDb db)
    {
        var ownerId = user.UserId();
        var manager = user.IsManager();
        var opportunities = db.Opportunities.Where(x => (manager || x.OwnerId == ownerId) &&
            x.Stage != "Ganada" && x.Stage != "Perdida");
        var rows = await (from party in db.Parties.AsNoTracking()
            join account in db.Accounts on party.OwnerId equals account.Id
            where manager || party.OwnerId == ownerId
            orderby party.Name, party.Id
            select new {
                party,
                owner = account.Name,
                opportunityCount = opportunities.Count(x => x.PartyId == party.Id),
                opportunityValue = opportunities.Where(x => x.PartyId == party.Id).Sum(x => x.Value),
                lastActivity = db.HistoryEntries.Where(x => x.PartyId == party.Id).Max(x => (DateTimeOffset?)x.At)
            }).ToListAsync();
        return Results.Ok(rows);
    }

    private static async Task<IResult> Save(int? id, PartyInput input, ClaimsPrincipal user, CrmDb db)
    {
        if (!Text(input.Name, 150, true) || !Text(input.Contact, 120) || !Email(input.Email) ||
            !Text(input.Phone, 35) || !Text(input.Source, 80) || !Text(input.Rfc, 13) ||
            !Text(input.Industry, 100) || !Text(input.Address, 250) ||
            input.Kind is not ("Cliente" or "Prospecto") || input.PersonType is not ("Empresa" or "Persona física") ||
            input.Stage is not ("Nuevo" or "En seguimiento" or "Calificado" or "No calificado"))
            return Error("Revisa el nombre, los datos de contacto y el estado.");

        var party = id is null ? new Party { Kind = input.Kind, OwnerId = user.UserId() } : await db.Parties.FindAsync(id.Value);
        if (party is null || !user.CanSee(party.OwnerId)) return Results.NotFound();
        if (party.Kind != input.Kind) return Error("Usa la acción de conversión para cambiar el tipo.");
        if (input.OwnerId.HasValue && input.OwnerId.Value != party.OwnerId)
        {
            if (!user.IsManager()) return Results.Forbid();
            if (!await db.Accounts.AnyAsync(x => x.Id == input.OwnerId.Value && x.Active && Commercial.Contains(x.Role)))
                return Error("Selecciona un responsable comercial activo.");
            var opportunities = await db.Opportunities.Where(x => x.PartyId == party.Id && x.OwnerId == party.OwnerId)
                .ToListAsync();
            party.OwnerId = input.OwnerId.Value;
            foreach (var opportunity in opportunities) opportunity.OwnerId = party.OwnerId;
        }
        party.Name = Clean(input.Name);
        party.PersonType = input.PersonType;
        party.Contact = Clean(input.Contact);
        party.Email = Clean(input.Email);
        party.Phone = Clean(input.Phone);
        party.Source = Clean(input.Source);
        party.Rfc = Clean(input.Rfc).ToUpperInvariant();
        party.Industry = Clean(input.Industry);
        party.Address = Clean(input.Address);
        party.Stage = input.Stage;
        party.Active = input.Active;
        party.Revision = Guid.NewGuid();
        if (id is null)
        {
            db.Parties.Add(party);
            db.HistoryEntries.Add(new HistoryEntry { Party = party, Type = "Ficha",
                Description = party.Kind == "Cliente" ? ClientRegistered : "Se registró la ficha de prospecto.",
                Actor = user.Identity!.Name! });
        }
        else WorkEndpoints.Log(db, party.Id, "Ficha", party.Active ? "Se actualizó la ficha." : "Se desactivó la ficha.", user);
        await db.SaveChangesAsync();
        return Results.Ok(party);
    }

    private static async Task<IResult> Details(int id, ClaimsPrincipal user, CrmDb db)
    {
        var party = await db.Parties.FindAsync(id);
        if (party is null || !user.CanSee(party.OwnerId)) return Results.NotFound();
        var contacts = await db.Contacts.Where(x => x.PartyId == id).OrderBy(x => x.Name).ToListAsync();
        var opportunities = await db.Opportunities.Where(x => x.PartyId == id).OrderByDescending(x => x.Id).ToListAsync();
        var owner = await db.Accounts.Where(x => x.Id == party.OwnerId).Select(x => x.Name).SingleAsync();
        var createdAt = await db.HistoryEntries.Where(x => x.PartyId == id && x.Type == "Ficha" &&
                (x.Description == ClientRegistered || x.Description == "Se registró la ficha de prospecto."))
            .MinAsync(x => (DateTimeOffset?)x.At);
        var notes = await db.Modules.AnyAsync(x => x.Key == "historial" && x.Enabled) && Modules["historial"].Any(user.IsInRole)
            ? await db.HistoryEntries.Where(x => x.PartyId == id && x.Type == "Comentario")
                .OrderByDescending(x => x.At).ThenByDescending(x => x.Id).Take(3)
                .Select(x => new { x.Id, x.Description, x.Actor, x.At }).ToListAsync()
            : [];
        return Results.Ok(new { party, contacts, opportunities, owner, createdAt, notes });
    }

    internal const string ClientRegistered = "Se registró la ficha de cliente.";
    internal const string ClientConverted = "El prospecto se convirtió en cliente.";

    private static async Task<IResult> Convert(int id, ClaimsPrincipal user, CrmDb db)
    {
        var party = await db.Parties.FindAsync(id);
        if (party is null || !user.CanSee(party.OwnerId)) return Results.NotFound();
        if (!party.Active || party.Kind != "Prospecto") return Conflict("Selecciona un prospecto activo.");
        party.Kind = "Cliente";
        WorkEndpoints.Log(db, party.Id, "Ficha", ClientConverted, user);
        party.Revision = Guid.NewGuid();
        await db.SaveChangesAsync();
        return Results.Ok(party);
    }

    private static async Task<IResult> AddContact(int id, ContactInput input, ClaimsPrincipal user, CrmDb db)
    {
        var party = await db.Parties.FindAsync(id);
        if (party is null || !user.CanSee(party.OwnerId)) return Results.NotFound();
        if (!party.Active || !Text(input.Name, 120, true) || !Text(input.Position, 80) || !Email(input.Email) || !Text(input.Phone, 35))
            return Error("Revisa los datos del contacto y confirma que la ficha esté activa.");
        var contact = new Contact { PartyId = id, Name = Clean(input.Name), Position = Clean(input.Position), Email = Clean(input.Email), Phone = Clean(input.Phone) };
        db.Contacts.Add(contact);
        WorkEndpoints.Log(db, party.Id, "Contacto", $"Se agregó a {contact.Name}.", user);
        await db.SaveChangesAsync();
        return Results.Ok(contact);
    }

    private static async Task<IResult> Pipeline(ClaimsPrincipal user, CrmDb db)
    {
        var owner = user.UserId();
        var manager = user.IsManager();
        return Results.Ok(await (from opportunity in db.Opportunities.AsNoTracking()
            join party in db.Parties on opportunity.PartyId equals party.Id
            join account in db.Accounts on opportunity.OwnerId equals account.Id
            where party.Active && (manager || (party.OwnerId == owner && opportunity.OwnerId == owner))
            orderby opportunity.UpdatedAt descending
            select new { opportunity.Id, opportunity.PartyId, party = party.Name, owner = account.Name,
                opportunity.Description, opportunity.Interest, opportunity.Value, opportunity.ExpectedClose,
                opportunity.Stage, opportunity.UpdatedAt }).ToListAsync());
    }

    private static async Task<IResult> MoveOpportunity(int id, StageInput input, ClaimsPrincipal user, CrmDb db)
    {
        if (!OpportunityStages.Contains(input.Stage)) return Error("Selecciona una etapa válida.");
        var item = await db.Opportunities.FindAsync(id);
        if (item is null || !user.CanSee(item.OwnerId)) return Results.NotFound();
        var party = await db.Parties.FindAsync(item.PartyId);
        if (party is not { Active: true } || !user.CanSee(party.OwnerId)) return Results.NotFound();
        if (item.Stage != input.Stage)
        {
            WorkEndpoints.Log(db, party.Id, "Oportunidad", $"{item.Description} · {item.Stage} → {input.Stage}", user);
            item.Stage = input.Stage;
            item.UpdatedAt = DateTimeOffset.UtcNow;
            item.Revision = Guid.NewGuid();
            await db.SaveChangesAsync();
        }
        return Results.NoContent();
    }
    private sealed record StageInput(string Stage);

    private static async Task<IResult> SaveOpportunity(int id, int? opportunityId, OpportunityInput input, ClaimsPrincipal user, CrmDb db)
    {
        var party = await db.Parties.FindAsync(id);
        if (party is null || !user.CanSee(party.OwnerId)) return Results.NotFound();
        if (!party.Active || !Text(input.Description, 250, true) || !Text(input.Interest, 150) ||
            input.Value is < 0 or > 100_000_000 || !OpportunityStages.Contains(input.Stage))
            return Error("Revisa la descripción, el valor y la etapa de la oportunidad.");
        var opportunity = opportunityId is null ? new Opportunity { PartyId = id, OwnerId = party.OwnerId }
            : await db.Opportunities.SingleOrDefaultAsync(x => x.Id == opportunityId && x.PartyId == id);
        if (opportunity is null) return Results.NotFound();
        opportunity.Description = Clean(input.Description);
        opportunity.Interest = Clean(input.Interest);
        opportunity.Value = Round(input.Value);
        opportunity.ExpectedClose = input.ExpectedClose;
        if (opportunityId is null || opportunity.Stage != input.Stage)
            WorkEndpoints.Log(db, party.Id, "Oportunidad", $"{opportunity.Description} · {input.Stage}", user);
        opportunity.Stage = input.Stage;
        opportunity.UpdatedAt = DateTimeOffset.UtcNow;
        opportunity.Revision = Guid.NewGuid();
        if (opportunityId is null) db.Opportunities.Add(opportunity);
        await db.SaveChangesAsync();
        return Results.Ok(opportunity);
    }

    private sealed record PartyInput(string Kind, string? Name, string PersonType, string Stage, bool Active = true,
        string? Contact = null, string? Email = null, string? Phone = null, string? Source = null,
        string? Rfc = null, string? Industry = null, string? Address = null, int? OwnerId = null);
    private sealed record ContactInput(string? Name, string? Position = null, string? Email = null, string? Phone = null);
    private sealed record OpportunityInput(string? Description, decimal Value, string Stage,
        string? Interest = null, DateOnly? ExpectedClose = null);
}
