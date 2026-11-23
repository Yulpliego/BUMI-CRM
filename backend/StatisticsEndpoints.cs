using System.Globalization;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using static NexoCrm.CrmRules;

namespace NexoCrm;

public static class StatisticsEndpoints
{
    public static void Map(WebApplication app)
    {
        var group = app.Module("estadisticas");
        group.MapGet("", Get);
        group.MapGet("/operaciones", Operations);
        group.MapGet("/registros", BusinessRecords);
    }

    private static async Task<IResult> Get(DateOnly? desde, DateOnly? hasta, string? estado, int? responsable,
        ClaimsPrincipal user, CrmDb db)
    {
        var today = Today();
        var start = desde ?? new DateOnly(today.Year, today.Month, 1).AddMonths(-12);
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
        var periodQuotes = quotes.Where(x => !x.IsDirectSale && x.Date >= start && x.Date <= end);
        var quoteCount = await periodQuotes.CountAsync();
        var accepted = await periodQuotes.CountAsync(x => x.Status == "Aceptada");

        var includeCampaign = (user.IsInRole("Administrador") || user.IsInRole("Gerente")) &&
            await db.Modules.AnyAsync(x => x.Key == "marketing" && x.Enabled);
        var query = from sale in db.Sales.AsNoTracking()
            join quote in quotes on sale.QuoteId equals quote.Id
            join owner in db.Accounts on quote.OwnerId equals owner.Id
            where sale.Date >= start && sale.Date <= end
              && (estado == null || estado == "" ? sale.Status != "Cancelada" : sale.Status == estado)
            join origin in db.CampaignOrigins on quote.PartyId equals origin.PartyId into origins
            from origin in origins.DefaultIfEmpty()
            join campaign in db.Campaigns on origin.CampaignId equals campaign.Id into marketing
            from campaign in marketing.DefaultIfEmpty()
            select new AnalyticalSale(sale.Id, sale.Date, sale.Status, quote.Total, quote.Lines, owner.Name,
                includeCampaign && campaign != null && quote.Date >= origin!.CapturedOn ? campaign.Name : null);
        var sales = await query.ToListAsync();
        var totals = sales.GroupBy(x => (x.Date.Year, x.Date.Month))
            .ToDictionary(x => x.Key, x => (Total: x.Sum(y => y.Total), Count: x.Count()));
        var months = new List<MonthlySales>();
        var culture = CultureInfo.GetCultureInfo("es-MX");
        for (var month = new DateOnly(start.Year, start.Month, 1); month <= end; month = month.AddMonths(1))
        {
            var (total, count) = totals.GetValueOrDefault((month.Year, month.Month));
            months.Add(new(month.ToString("MMM yy", culture), total, count, month));
        }

        var owners = user.IsManager() ? await db.Accounts.Where(x => Commercial.Contains(x.Role))
            .OrderBy(x => x.Name).Select(x => new { x.Id, x.Name }).ToListAsync() : [];
        return Results.Ok(new
        {
            clients, leads, quoteCount, accepted, salesCount = sales.Count, revenue = sales.Sum(x => x.Total),
            start, end, months, stages, owners,
            forecast = estado == "Cancelada" ? new SalesForecast.Result(null, 0, null, null, [], "Selecciona ventas vigentes para proyectar los importes.") :
                SalesForecast.Train(months, start, end, today, culture),
            validation = SalesValidation(months, start, end, today, culture, estado),
            variation = Variation(months, sales, start, end, today),
            byStatus = sales.GroupBy(x => x.Status).Select(x => new { status = x.Key, count = x.Count() }).OrderByDescending(x => x.count),
            byOwner = sales.GroupBy(x => x.Name).OrderByDescending(x => x.Sum(y => y.Total))
                .Select(x => new { name = x.Key, total = x.Sum(y => y.Total) }),
            products = sales.SelectMany(x => x.Lines).GroupBy(x => x.Product, StringComparer.OrdinalIgnoreCase)
                .Select(x => new { name = x.Key, quantity = x.Sum(y => y.Quantity) }).OrderByDescending(x => x.quantity).Take(6)
        });
    }

    private static async Task<IResult> Operations(DateOnly desde, DateOnly hasta, string? estado, int? responsable,
        DateOnly? mes, string? producto, string? vendedor, string? estadoDetalle, int? pagina, ClaimsPrincipal user, CrmDb db)
    {
        if (!(await WorkEndpoints.Enabled(user, db)).Contains("ventas")) return Results.Forbid();
        var page = pagina ?? 1;
        if (desde > hasta || hasta.DayNumber - desde.DayNumber > 730 || page is < 1 or > 10000 ||
            !Text(producto, 120) || !Text(vendedor, 150)) return Error("Revisa el periodo o los filtros de detalle.");
        if (mes.HasValue)
        {
            var start = new DateOnly(mes.Value.Year, mes.Value.Month, 1);
            var end = start.AddMonths(1).AddDays(-1);
            desde = desde > start ? desde : start;
            hasta = hasta < end ? hasta : end;
        }
        int? ownerId = user.IsManager() ? responsable : user.UserId();
        var query = from sale in db.Sales.AsNoTracking()
            join quote in db.Quotes on sale.QuoteId equals quote.Id
            join owner in db.Accounts on quote.OwnerId equals owner.Id
            join party in db.Parties on quote.PartyId equals party.Id
            where sale.Date >= desde && sale.Date <= hasta && (!ownerId.HasValue || owner.Id == ownerId) &&
                (string.IsNullOrEmpty(estado) ? sale.Status != "Cancelada" : sale.Status == estado) &&
                (string.IsNullOrEmpty(estadoDetalle) || sale.Status == estadoDetalle) &&
                (string.IsNullOrEmpty(vendedor) || owner.Name == vendedor) &&
                (string.IsNullOrEmpty(producto) || quote.Lines.Any(x => x.Product == producto))
            orderby sale.Date descending, sale.Id descending
            select new { sale.Id, sale.Date, sale.Status, party = party.Name, owner = owner.Name, quote.Total };
        var count = await query.CountAsync();
        return Results.Ok(new { count, page, rows = await query.Skip((page - 1) * 25).Take(25).ToListAsync() });
    }

    private static async Task<IResult> BusinessRecords(string origen, DateOnly desde, DateOnly hasta, int? responsable,
        string? estadoDetalle, int? pagina, ClaimsPrincipal user, CrmDb db)
    {
        var page = pagina ?? 1;
        if (desde > hasta || hasta.DayNumber - desde.DayNumber > 730 || page is < 1 or > 10000 ||
            origen is not ("cotizaciones" or "cartera" or "oportunidades") || !Text(estadoDetalle, 40))
            return Error("Revisa el tipo de registro o los filtros de detalle.");
        var enabled = await WorkEndpoints.Enabled(user, db);
        if (!enabled.Contains(origen == "cotizaciones" ? "cotizaciones" : "clientes")) return Results.Forbid();
        int? ownerId = user.IsManager() ? responsable : user.UserId();
        var parties = db.Parties.AsNoTracking().Where(x => x.Active && (!ownerId.HasValue || x.OwnerId == ownerId));
        var filter = Clean(estadoDetalle);
        var today = Today();
        IQueryable<ReportRecord> query;
        switch (origen)
        {
            case "cotizaciones":
                query = from quote in db.Quotes.AsNoTracking()
                    join party in db.Parties on quote.PartyId equals party.Id
                    join account in db.Accounts on quote.OwnerId equals account.Id
                    where !quote.IsDirectSale && quote.Date >= desde && quote.Date <= hasta &&
                        (!ownerId.HasValue || quote.OwnerId == ownerId)
                    let status = quote.Status == "Enviada" && quote.ValidUntil < today ? "Vencida" : quote.Status
                    where filter == "" || status == filter
                    orderby quote.Date descending, quote.Id descending
                    select new ReportRecord(quote.Id, quote.Date, status, party.Name, account.Name, quote.Total, null, null);
                break;
            case "cartera":
                query = from party in parties
                    join account in db.Accounts on party.OwnerId equals account.Id
                    where filter == "" || party.Kind == filter
                    orderby party.Name, party.Id
                    select new ReportRecord(party.Id, null, party.Kind, party.Name, account.Name, null, party.Id, null);
                break;
            default:
                query = from item in db.Opportunities.AsNoTracking()
                    join party in parties on item.PartyId equals party.Id
                    join account in db.Accounts on item.OwnerId equals account.Id
                    where (!ownerId.HasValue || item.OwnerId == ownerId) && (filter == "" || item.Stage == filter)
                    orderby item.UpdatedAt descending, item.Id descending
                    select new ReportRecord(item.Id, item.ExpectedClose, item.Stage, party.Name, account.Name, item.Value, party.Id, item.Description);
                break;
        }
        return Results.Ok(new { count = await query.CountAsync(), page, rows = await query.Skip((page - 1) * 25).Take(25).ToListAsync() });
    }

    private sealed record ReportRecord(int Id, DateOnly? Date, string Status, string Party, string Owner, decimal? Total,
        int? PartyId, string? Description);

    private static object SalesValidation(List<MonthlySales> months, DateOnly start, DateOnly end, DateOnly today,
        CultureInfo culture, string? status)
    {
        if (status == "Cancelada") return Array.Empty<object>();
        var completed = CompleteMonths(months, start, end, today);
        return completed.Skip(6).TakeLast(6).Select(month =>
        {
            var estimate = SalesForecast.Train(months, start, month.Month.AddDays(-1), today, culture).Forecast.FirstOrDefault();
            return estimate is null ? null : new { month.Label, actual = month.Total, expected = estimate.Estimate,
                error = Math.Abs(month.Total - estimate.Estimate) };
        }).OfType<object>().ToArray();
    }

    private static MonthlySales[] CompleteMonths(List<MonthlySales> months, DateOnly start, DateOnly end, DateOnly today) =>
        months.Where(m => m.Month >= start && m.Month.AddMonths(1) <= today && m.Month.AddMonths(1).AddDays(-1) <= end).ToArray();

    private static object? Variation(List<MonthlySales> months, List<AnalyticalSale> sales, DateOnly start, DateOnly end, DateOnly today)
    {
        var completed = CompleteMonths(months, start, end, today);
        if (completed.Length < 2) return null;
        var previous = completed[^2];
        var current = completed[^1];
        var delta = current.Total - previous.Total;
        var percent = previous.Total > 0 ? Round(100 * delta / previous.Total) : (decimal?)null;
        var flagged = Math.Abs(delta) >= 1000 && (percent is null ? current.Total > 0 : Math.Abs(percent.Value) >= 25);
        var signed = sales.Where(x => x.Date >= previous.Month && x.Date < current.Month.AddMonths(1))
            .Select(x => (Sale: x, Sign: x.Date >= current.Month ? 1 : -1)).ToArray();
        static object[] Drivers(IEnumerable<(string Name, decimal Delta)> rows) => rows.GroupBy(x => x.Name)
            .Select(g => new { name = g.Key, delta = Round(g.Sum(x => x.Delta)) })
            .Where(x => x.delta != 0).OrderByDescending(x => Math.Abs(x.delta)).Take(3).Cast<object>().ToArray();
        return new { previous = previous.Label, current = current.Label, delta, percent, flagged,
            owners = Drivers(signed.Select(x => (x.Sale.Name, x.Sign * x.Sale.Total))),
            campaigns = Drivers(signed.Where(x => x.Sale.Campaign is not null).Select(x => (x.Sale.Campaign!, x.Sign * x.Sale.Total))),
            products = Drivers(signed.SelectMany(x => x.Sale.Lines.Select(l =>
                (l.Product, x.Sign * l.Quantity * l.Price * (1 - l.Discount / 100))))) };
    }

    private sealed record AnalyticalSale(int Id, DateOnly Date, string Status, decimal Total, List<QuoteLine> Lines, string Name, string? Campaign);
}
