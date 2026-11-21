using System.Globalization;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using static NexoCrm.CrmRules;

namespace NexoCrm;

public static class StatisticsEndpoints
{
    public static void Map(WebApplication app) => app.Module("estadisticas").MapGet("", Get);

    private static async Task<IResult> Get(DateOnly? desde, DateOnly? hasta, string? estado, int? responsable,
        ClaimsPrincipal user, CrmDb db)
    {
        var today = Today();
        var start = desde ?? new DateOnly(today.Year, today.Month, 1).AddMonths(-5);
        var end = hasta ?? today;
        if (start > end || end.DayNumber - start.DayNumber > 730)
            return Error("Selecciona un periodo de hasta dos años.");
        if (estado is not (null or "" or "Registrada" or "En proceso" or "Completada" or "Cancelada"))
            return Error("Selecciona un estado válido.");

        int? ownerId = user.IsManager() ? responsable : user.UserId();
        var parties = db.Parties.AsNoTracking().Where(x => x.Active && (!ownerId.HasValue || x.OwnerId == ownerId));
        var clients = await parties.CountAsync(x => x.Kind == "Cliente");
        var leads = await parties.CountAsync(x => x.Kind == "Prospecto");
        var stages = await db.Opportunities.Where(x => !ownerId.HasValue || x.OwnerId == ownerId)
            .Join(parties, x => x.PartyId, x => x.Id, (opportunity, _) => opportunity)
            .GroupBy(x => x.Stage).Select(x => new { stage = x.Key, count = x.Count() }).ToListAsync();

        var quotes = db.Quotes.AsNoTracking().Where(x => !ownerId.HasValue || x.OwnerId == ownerId);
        var periodQuotes = quotes.Where(x => x.Date >= start && x.Date <= end);
        var quoteCount = await periodQuotes.CountAsync();
        var accepted = await periodQuotes.CountAsync(x => x.Status == "Aceptada");

        var query = from sale in db.Sales.AsNoTracking()
            join quote in quotes on sale.QuoteId equals quote.Id
            join owner in db.Accounts on quote.OwnerId equals owner.Id
            where sale.Date >= start && sale.Date <= end
              && (estado == null || estado == "" ? sale.Status != "Cancelada" : sale.Status == estado)
            select new { sale.Date, quote.Total, quote.Lines, owner.Name };
        var sales = await query.ToListAsync();
        var totals = sales.GroupBy(x => (x.Date.Year, x.Date.Month)).ToDictionary(x => x.Key, x => x.Sum(y => y.Total));
        var months = new List<object>();
        var culture = CultureInfo.GetCultureInfo("es-MX");
        for (var month = new DateOnly(start.Year, start.Month, 1); month <= end; month = month.AddMonths(1))
            months.Add(new { label = month.ToString("MMM yy", culture), total = totals.GetValueOrDefault((month.Year, month.Month)) });

        var owners = user.IsManager() ? await db.Accounts.Where(x => Commercial.Contains(x.Role))
            .OrderBy(x => x.Name).Select(x => new { x.Id, x.Name }).ToListAsync() : [];
        return Results.Ok(new
        {
            clients, leads, quoteCount, accepted, salesCount = sales.Count, revenue = sales.Sum(x => x.Total),
            start, end, months, stages, owners,
            byOwner = sales.GroupBy(x => x.Name).OrderByDescending(x => x.Sum(y => y.Total))
                .Select(x => new { name = x.Key, total = x.Sum(y => y.Total) }),
            products = sales.SelectMany(x => x.Lines).GroupBy(x => x.Product, StringComparer.OrdinalIgnoreCase)
                .Select(x => new { name = x.Key, quantity = x.Sum(y => y.Quantity) }).OrderByDescending(x => x.quantity).Take(6)
        });
    }
}
