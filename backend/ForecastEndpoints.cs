using Microsoft.EntityFrameworkCore;
using static NexoCrm.CrmRules;

namespace NexoCrm;

public static class ForecastEndpoints
{
    public static void Map(WebApplication app) => app.Module("marketing").MapGet("/pronostico", Forecast);

    private static async Task<IResult> Forecast(string? canal, int? contactos, CrmDb db)
    {
        var target = contactos ?? 100;
        if (target is < 1 or > 100_000) return Error("Indica entre 1 y 100 000 contactos.");
        var history = await db.Campaigns.AsNoTracking()
            .Where(x => x.Status == "Finalizada" && x.Reached > 0 && x.Leads >= 0 && x.Leads <= x.Reached)
            .GroupBy(x => x.Channel)
            .Select(group => new { channel = group.Key, campaigns = group.Count(), reached = group.Sum(x => (long)x.Reached),
                leads = group.Sum(x => (long)x.Leads) }).ToListAsync();
        var channel = Clean(canal);
        var selected = history.Where(x => channel.Length == 0 || x.channel == channel).ToList();
        var projections = selected.OrderBy(x => x.channel).Select(x => new
        {
            x.channel, x.campaigns, x.reached, x.leads,
            estimate = Estimate(x.reached, x.leads, target)
        });
        var contacts = selected.Sum(x => x.reached);
        var leads = selected.Sum(x => x.leads);
        var campaigns = selected.Sum(x => x.campaigns);
        if (contacts == 0)
            return Results.Ok(new { available = false, target, history, projections, message = "Finaliza una campaña con resultados para obtener una estimación." });

        var estimate = Estimate(contacts, leads, target);
        return Results.Ok(new
        {
            available = true, target, contacts, leads, campaigns, history, projections,
            estimate.Rate, estimate.Expected, estimate.Low, estimate.High,
            limited = campaigns < 3 || contacts < 100
        });
    }

    private static LeadEstimate Estimate(long contacts, long leads, int target)
    {
        // Wilson interval for historical conversion projected onto the requested audience.
        const double z = 1.96;
        var rate = leads / (double)contacts;
        var denominator = 1 + z * z / contacts;
        var midpoint = (rate + z * z / (2 * contacts)) / denominator;
        var margin = z * Math.Sqrt((rate * (1 - rate) + z * z / (4 * contacts)) / contacts) / denominator;
        return new LeadEstimate(rate, (int)Math.Round(rate * target, MidpointRounding.AwayFromZero),
            Math.Max(0, (int)Math.Floor((midpoint - margin) * target)),
            Math.Min(target, (int)Math.Ceiling((midpoint + margin) * target)));
    }

    private sealed record LeadEstimate(double Rate, int Expected, int Low, int High);
}
