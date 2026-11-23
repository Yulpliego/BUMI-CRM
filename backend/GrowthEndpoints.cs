using System.Security.Claims;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using static NexoCrm.CrmRules;

namespace NexoCrm;

internal static partial class GrowthEndpoints
{
    public static void Map(WebApplication app)
    {
        var marketing = app.Module("marketing");
        marketing.MapGet("/atribucion", Attribution);
        marketing.MapPut("/{id:int}/origen", RecordOrigin)
            .RequireAuthorization(p => p.RequireRole("Marketing", "Administrador"));
        var parties = app.Module("clientes");
        parties.MapGet("/duplicados", Duplicates);
        parties.MapPost("/{id:int}/fusion", Merge).RequireAuthorization(p => p.RequireRole(Managers));
        parties.MapGet("/oportunidades/sugerencias", Suggestions);
    }

    private static async Task<IResult> Attribution(CrmDb db)
    {
        var campaigns = await db.Campaigns.OrderBy(x => x.Name).Select(x => new { x.Id, x.Name, x.Channel, x.Segment, x.Start, x.End }).ToListAsync();
        var contacts = await (from origin in db.CampaignOrigins
            join party in db.Parties on origin.PartyId equals party.Id
            select new { origin.CampaignId, origin.PartyId, party.Name, origin.Segment, origin.Source, origin.Cost, origin.CapturedOn }).ToListAsync();
        var quotations = await (from origin in db.CampaignOrigins
            join quote in db.Quotes on origin.PartyId equals quote.PartyId
            where !quote.IsDirectSale && quote.Date >= origin.CapturedOn
            select new { origin.CampaignId, origin.Segment }).ToListAsync();
        var sales = await (from origin in db.CampaignOrigins
            join quote in db.Quotes on origin.PartyId equals quote.PartyId
            join sale in db.Sales on quote.Id equals sale.QuoteId
            where sale.Status != "Cancelada" && quote.Date >= origin.CapturedOn && sale.Date >= origin.CapturedOn
            select new { origin.CampaignId, origin.Segment, origin.PartyId, quote.Total }).ToListAsync();

        var report = campaigns.Select(campaign => new
        {
            campaign,
            segments = contacts.Where(x => x.CampaignId == campaign.Id).GroupBy(x => x.Segment).Select(group =>
            {
                var costs = group.Sum(x => x.Cost);
                var attributed = sales.Where(x => x.CampaignId == campaign.Id && x.Segment == group.Key).ToArray();
                return new { segment = group.Key, prospects = group.Count(), cost = costs, costPerProspect = Round(costs / group.Count()),
                    quotes = quotations.Count(x => x.CampaignId == campaign.Id && x.Segment == group.Key),
                    sales = attributed.Length, soldProspects = attributed.Select(x => x.PartyId).Distinct().Count(),
                    revenue = attributed.Sum(x => x.Total) };
            })
        });
        var channels = campaigns.GroupBy(c => c.Channel).Select(group =>
        {
            var ids = group.Select(c => c.Id).ToHashSet();
            var people = contacts.Where(x => ids.Contains(x.CampaignId)).ToArray();
            var attributed = sales.Where(x => ids.Contains(x.CampaignId)).ToArray();
            var cost = people.Sum(x => x.Cost);
            return new { channel = group.Key, prospects = people.Length, cost,
                costPerProspect = people.Length == 0 ? (decimal?)null : Round(cost / people.Length),
                quotations = quotations.Count(x => ids.Contains(x.CampaignId)), sales = attributed.Length,
                revenue = attributed.Sum(x => x.Total) };
        }).OrderByDescending(x => x.revenue);
        return Results.Ok(new { report, contacts, channels });
    }

    private static async Task<IResult> RecordOrigin(int id, OriginInput input, CrmDb db)
    {
        var campaign = await db.Campaigns.Include(x => x.Audience).SingleOrDefaultAsync(x => x.Id == id);
        if (campaign is null) return Results.NotFound();
        if (input.CapturedOn < campaign.Start || input.CapturedOn > campaign.End || input.CapturedOn > Today() ||
            input.Cost is < 0 or > 1_000_000 || !Text(input.Source, 100, true) || !Text(input.Segment, 100, true) ||
            !campaign.Audience.Any(x => x.Id == input.PartyId && x.Active))
            return Error("Selecciona una ficha activa del público, una fecha dentro de la campaña y sus datos de captación.");

        var row = await db.CampaignOrigins.SingleOrDefaultAsync(x => x.PartyId == input.PartyId);
        if (row is not null && row.CampaignId != id) return Conflict("Esta ficha ya tiene otra campaña de origen.");
        if (row is null)
        {
            row = new CampaignOrigin { CampaignId = id, PartyId = input.PartyId };
            db.CampaignOrigins.Add(row);
        }
        row.CapturedOn = input.CapturedOn;
        row.Source = Clean(input.Source);
        row.Segment = Clean(input.Segment);
        row.Cost = Round(input.Cost);
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        { return Conflict("La ficha ya tiene una campaña de origen. Recarga el informe."); }
        return Results.NoContent();
    }

    private static async Task<IResult> Duplicates(string? correo, string? telefono, string? rfc, int? excluir,
        ClaimsPrincipal user, CrmDb db)
    {
        var visible = await db.Parties.Where(x => x.Active && (user.IsManager() || x.OwnerId == user.UserId()) && x.Id != excluir)
            .Select(x => new { x.Id, x.Name, x.Email, x.Phone, x.Rfc, x.Kind }).ToListAsync();
        var email = Clean(correo);
        var phone = Digits().Replace(Clean(telefono), "");
        var tax = Clean(rfc);
        return Results.Ok(visible.Select(p => new { p.Id, p.Name, p.Kind,
            matches = new[] { email.Length > 0 && email.Equals(p.Email, StringComparison.OrdinalIgnoreCase) ? "Correo" : null,
                phone.Length >= 7 && phone == Digits().Replace(p.Phone, "") ? "Teléfono" : null,
                tax.Length > 0 && tax.Equals(p.Rfc, StringComparison.OrdinalIgnoreCase) ? "RFC" : null }.OfType<string>().ToArray()
        }).Where(x => x.matches.Length > 0).Take(20));
    }

    private static async Task<IResult> Merge(int id, MergeInput input, ClaimsPrincipal user, CrmDb db)
    {
        if (id == input.SourceId || !Text(input.Reason, 300, true)) return Error("Selecciona dos fichas distintas e indica el motivo.");
        await using var tx = await db.Database.BeginTransactionAsync();
        var target = await db.Parties.FindAsync(id);
        var source = await db.Parties.FindAsync(input.SourceId);
        if (target is not { Active: true } || source is not { Active: true }) return Results.NotFound();
        if (source.Kind == "Cliente" && target.Kind != "Cliente") return Conflict("Conserva la ficha del cliente como destino.");
        var origins = await db.CampaignOrigins.Where(x => x.PartyId == id || x.PartyId == source.Id).ToListAsync();
        if (origins.Count == 2)
            return Conflict("Ambas fichas tienen captación registrada. Revisa su atribución antes de fusionarlas.");
        await db.Contacts.Where(x => x.PartyId == source.Id).ExecuteUpdateAsync(s => s.SetProperty(x => x.PartyId, id));
        await db.Quotes.Where(x => x.PartyId == source.Id).ExecuteUpdateAsync(s => s.SetProperty(x => x.PartyId, id).SetProperty(x => x.Revision, x => Guid.NewGuid()));
        await db.Opportunities.Where(x => x.PartyId == source.Id).ExecuteUpdateAsync(s => s.SetProperty(x => x.PartyId, id)
            .SetProperty(x => x.OwnerId, target.OwnerId).SetProperty(x => x.Revision, x => Guid.NewGuid()));
        await db.AgendaItems.Where(x => x.PartyId == source.Id).ExecuteUpdateAsync(s => s.SetProperty(x => x.PartyId, id)
            .SetProperty(x => x.OwnerId, target.OwnerId).SetProperty(x => x.Revision, x => Guid.NewGuid()));
        await db.HistoryEntries.Where(x => x.PartyId == source.Id).ExecuteUpdateAsync(s => s.SetProperty(x => x.PartyId, id));
        foreach (var campaign in await db.Campaigns.Include(x => x.Audience).Where(x => x.Audience.Any(p => p.Id == source.Id)).ToListAsync())
        {
            campaign.Audience.Remove(source);
            if (!campaign.Audience.Contains(target)) campaign.Audience.Add(target);
            campaign.Revision = Guid.NewGuid();
        }
        if (origins.SingleOrDefault() is { } origin && origin.PartyId == source.Id)
            await db.CampaignOrigins.Where(x => x.PartyId == source.Id).ExecuteUpdateAsync(s => s.SetProperty(x => x.PartyId, id));

        if (source.Contact.Length > 0 && source.Contact != target.Contact &&
            !await db.Contacts.AnyAsync(x => x.PartyId == id && x.Name == source.Contact))
            db.Contacts.Add(new Contact { PartyId = id, Name = source.Contact, Email = source.Email, Phone = source.Phone });
        if (target.Email.Length == 0) target.Email = source.Email;
        if (target.Phone.Length == 0) target.Phone = source.Phone;
        if (target.Rfc.Length == 0) target.Rfc = source.Rfc;
        if (target.Contact.Length == 0) target.Contact = source.Contact;
        source.Active = false;
        source.Revision = Guid.NewGuid();
        target.Revision = Guid.NewGuid();
        WorkEndpoints.Log(db, id, "Fusión", $"Ficha #{source.Id} ({source.Name}) incorporada. {Clean(input.Reason)}", user);
        await db.SaveChangesAsync();
        await tx.CommitAsync();
        return Results.NoContent();
    }

    private static async Task<IResult> Suggestions(ClaimsPrincipal user, CrmDb db)
    {
        var today = Today();
        var stale = DateTimeOffset.UtcNow.AddDays(-7);
        var rows = await (from item in db.Opportunities
            join party in db.Parties on item.PartyId equals party.Id
            where party.Active && (user.IsManager() || (item.OwnerId == user.UserId() && party.OwnerId == user.UserId())) &&
                item.Stage != "Ganada" && item.Stage != "Perdida" &&
                (item.UpdatedAt <= stale || item.ExpectedClose <= today.AddDays(3))
            orderby item.ExpectedClose, item.Value descending
            select new { item.Id, item.PartyId, party.Name, item.Description, item.ExpectedClose, item.Value, item.Stage,
                reason = item.ExpectedClose <= today ? "Cierre estimado vencido" : item.ExpectedClose <= today.AddDays(3) ?
                "Cierre próximo" : item.Stage == "Propuesta" ? "Propuesta sin seguimiento reciente" : "Siete días sin seguimiento" }).Take(30).ToListAsync();
        return Results.Ok(rows);
    }

    private sealed record OriginInput(int PartyId, DateOnly CapturedOn, string? Source, string? Segment, decimal Cost);
    private sealed record MergeInput(int SourceId, string? Reason);
    [GeneratedRegex("[^0-9]")]
    private static partial Regex Digits();
}
