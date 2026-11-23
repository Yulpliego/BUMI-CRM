using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using static NexoCrm.CrmRules;

namespace NexoCrm;

internal static class HomeDashboard
{
    private static readonly TimeZoneInfo Mexico = TimeZoneInfo.FindSystemTimeZoneById("America/Mexico_City");

    public static async Task<IResult> Get(int? days, ClaimsPrincipal user, CrmDb db)
    {
        var period = days ?? 90;
        if (period is not (30 or 90 or 365)) return Error("Selecciona un periodo de 30, 90 o 365 días.");

        var modules = await WorkEndpoints.Enabled(user, db);
        var today = Today();
        var start = today.AddDays(1 - period);
        var previousStart = start.AddDays(-period);
        var ownerId = user.UserId();
        var manager = user.IsManager();
        var documents = db.Quotes.AsNoTracking().Where(x => manager || x.OwnerId == ownerId);
        var quotes = documents.Where(x => !x.IsDirectSale && x.Date >= start && x.Date <= today);
        var sales = from sale in db.Sales.AsNoTracking()
                    join document in documents on sale.QuoteId equals document.Id
                    where sale.Date >= previousStart && sale.Date <= today
                    select new { sale.Id, sale.Date, sale.Status, document.Total, document.PartyId, document.OwnerId };

        decimal? salesTotal = null;
        decimal? previousTotal = null;
        var series = new List<SalesPoint>();
        var operations = new List<Operation>();

        if (modules.Contains("ventas"))
        {
            var amounts = await sales.Where(x => x.Status != "Cancelada").GroupBy(x => x.Date)
                .Select(group => new { Date = group.Key, Total = group.Sum(x => x.Total) }).ToListAsync();
            previousTotal = amounts.Where(x => x.Date < start).Sum(x => x.Total);
            var current = amounts.Where(x => x.Date >= start).ToList();
            salesTotal = current.Sum(x => x.Total);
            for (var from = start; from <= today;)
            {
                var next = period == 30 ? from.AddDays(5) : new DateOnly(from.Year, from.Month, 1).AddMonths(1);
                var through = next > today ? today : next.AddDays(-1);
                series.Add(new SalesPoint(from, through, current.Where(x => x.Date >= from && x.Date <= through).Sum(x => x.Total)));
                from = next;
            }

            operations.AddRange(await (from sale in sales
                join party in db.Parties on sale.PartyId equals party.Id
                join account in db.Accounts on sale.OwnerId equals account.Id
                where sale.Date >= start
                orderby sale.Date descending, sale.Id descending
                select new Operation(sale.Id, "ventas", party.Name, account.Name, sale.Date, sale.Total, sale.Status))
                .Take(24).ToListAsync());
        }

        int? activeQuotes = null;
        decimal? activeQuoteValue = null;
        decimal? conversionRate = null;
        var acceptedQuotes = 0;
        var resolvedQuotes = 0;
        if (modules.Contains("cotizaciones"))
        {
            var counts = await quotes.GroupBy(x => x.Status == "Enviada" && x.ValidUntil < today ? "Vencida" : x.Status)
                .Select(group => new { Status = group.Key, Count = group.Count() })
                .ToDictionaryAsync(x => x.Status, x => x.Count);
            activeQuotes = counts.GetValueOrDefault("Borrador") + counts.GetValueOrDefault("Enviada");
            activeQuoteValue = await quotes.Where(x => x.Status == "Borrador" || (x.Status == "Enviada" && x.ValidUntil >= today))
                .SumAsync(x => x.Total);
            acceptedQuotes = counts.GetValueOrDefault("Aceptada");
            resolvedQuotes = acceptedQuotes + counts.GetValueOrDefault("Rechazada");
            if (resolvedQuotes > 0) conversionRate = Math.Round(100m * acceptedQuotes / resolvedQuotes, 1);

            operations.AddRange(await (from quote in quotes
                join party in db.Parties on quote.PartyId equals party.Id
                join account in db.Accounts on quote.OwnerId equals account.Id
                orderby quote.Date descending, quote.Id descending
                select new Operation(quote.Id, "cotizaciones", party.Name, account.Name, quote.Date, quote.Total,
                    quote.Status == "Enviada" && quote.ValidUntil < today ? "Vencida" : quote.Status))
                .Take(24).ToListAsync());
        }

        int? newClients = null;
        int? previousNewClients = null;
        OpportunityInsight? analyst = null;
        if (modules.Contains("clientes"))
        {
            var windowStart = LocalMidnight(previousStart);
            var windowEnd = LocalMidnight(today.AddDays(1));
            var currentStart = LocalMidnight(start);
            var clientEvents = from entry in db.HistoryEntries
                               join party in db.Parties on entry.PartyId equals party.Id
                               where (manager || party.OwnerId == ownerId) && entry.Type == "Ficha" &&
                                   (entry.Description == RelationshipEndpoints.ClientRegistered ||
                                    entry.Description == RelationshipEndpoints.ClientConverted) &&
                                   entry.At >= windowStart && entry.At < windowEnd
                               select new { entry.PartyId, entry.At };
            newClients = await clientEvents.Where(x => x.At >= currentStart).Select(x => x.PartyId).Distinct().CountAsync();
            previousNewClients = await clientEvents.Where(x => x.At < currentStart).Select(x => x.PartyId).Distinct().CountAsync();
            analyst = await AnalyzeOpportunities(today, ownerId, manager, db);
        }

        return Results.Ok(new
        {
            start, end = today, salesTotal, previousTotal, activeQuotes, activeQuoteValue, newClients, previousNewClients,
            conversionRate, acceptedQuotes, resolvedQuotes, analyst, series,
            operations = operations.OrderByDescending(x => x.Date).ThenBy(x => x.Module).ThenByDescending(x => x.Id).Take(24)
        });
    }

    private static DateTimeOffset LocalMidnight(DateOnly day) =>
        TimeZoneInfo.ConvertTimeToUtc(day.ToDateTime(TimeOnly.MinValue), Mexico);

    private static async Task<OpportunityInsight> AnalyzeOpportunities(DateOnly today, int ownerId, bool manager, CrmDb db)
    {
        var soon = today.AddDays(7);
        var open = from opportunity in db.Opportunities.AsNoTracking()
                   join party in db.Parties on opportunity.PartyId equals party.Id
                   where party.Active && (manager || (party.OwnerId == ownerId && opportunity.OwnerId == ownerId)) &&
                       opportunity.Stage != "Ganada" && opportunity.Stage != "Perdida"
                   select new { opportunity, Party = party.Name };
        var count = await open.CountAsync();
        var due = await open.CountAsync(x => x.opportunity.ExpectedClose <= soon);
        var suggestions = await open
            .OrderByDescending(x => x.opportunity.ExpectedClose.HasValue && x.opportunity.ExpectedClose <= soon)
            .ThenByDescending(x => x.opportunity.Stage == "Negociación")
            .ThenByDescending(x => x.opportunity.Stage == "Propuesta")
            .ThenByDescending(x => x.opportunity.Value)
            .ThenBy(x => x.opportunity.Id)
            .Select(x => new OpportunitySuggestion(x.opportunity.Id, x.Party, x.opportunity.Description,
                x.opportunity.Stage, x.opportunity.Value, x.opportunity.ExpectedClose,
                x.opportunity.ExpectedClose < today ? "Actualiza la fecha de cierre y confirma si sigue abierta." :
                x.opportunity.ExpectedClose <= soon ? "Confirma el siguiente paso antes del cierre previsto." :
                x.opportunity.Stage == "Negociación" ? "Confirma quién toma la decisión y qué falta para cerrar." :
                x.opportunity.Stage == "Propuesta" ? "Pide retroalimentación sobre la propuesta y agenda el seguimiento." :
                "Confirma la necesidad, el presupuesto y la fecha del próximo contacto."))
            .Take(3).ToListAsync();
        return new OpportunityInsight(count, due, suggestions);
    }

    private sealed record OpportunityInsight(int OpenCount, int DueSoon, List<OpportunitySuggestion> Suggestions);
    private sealed record OpportunitySuggestion(int Id, string Party, string Description, string Stage, decimal Value,
        DateOnly? ExpectedClose, string Recommendation);
    private sealed record SalesPoint(DateOnly From, DateOnly Through, decimal Total);
    private sealed record Operation(int Id, string Module, string Party, string Owner, DateOnly Date, decimal Total, string Status);
}

