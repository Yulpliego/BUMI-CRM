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
        if (id is null) db.Parties.Add(party);
        await db.SaveChangesAsync();
        return Results.Ok(party);
    }

    private static async Task<IResult> Details(int id, ClaimsPrincipal user, CrmDb db)
    {
        var party = await db.Parties.FindAsync(id);
        if (party is null || !user.CanSee(party.OwnerId)) return Results.NotFound();
        var contacts = await db.Contacts.Where(x => x.PartyId == id).OrderBy(x => x.Name).ToListAsync();
        var opportunities = await db.Opportunities.Where(x => x.PartyId == id).OrderByDescending(x => x.Id).ToListAsync();
        return Results.Ok(new { party, contacts, opportunities });
    }

    private static async Task<IResult> Convert(int id, ClaimsPrincipal user, CrmDb db)
    {
        var party = await db.Parties.FindAsync(id);
        if (party is null || !user.CanSee(party.OwnerId)) return Results.NotFound();
        if (!party.Active || party.Kind != "Prospecto") return Conflict("Selecciona un prospecto activo.");
        party.Kind = "Cliente";
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
        await db.SaveChangesAsync();
        return Results.Ok(contact);
    }

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
        opportunity.Stage = input.Stage;
        if (opportunityId is null) db.Opportunities.Add(opportunity);
        await db.SaveChangesAsync();
        return Results.Ok(opportunity);
    }

    private sealed record PartyInput(string Kind, string? Name, string PersonType, string Stage, bool Active = true,
        string? Contact = null, string? Email = null, string? Phone = null, string? Source = null,
        string? Rfc = null, string? Industry = null, string? Address = null);
    private sealed record ContactInput(string? Name, string? Position = null, string? Email = null, string? Phone = null);
    private sealed record OpportunityInput(string? Description, decimal Value, string Stage,
        string? Interest = null, DateOnly? ExpectedClose = null);
}
