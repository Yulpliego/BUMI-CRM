using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using static NexoCrm.CrmRules;

namespace NexoCrm;

internal static class WorkImprovements
{
    private static readonly TimeZoneInfo Mexico = TimeZoneInfo.FindSystemTimeZoneById("America/Mexico_City");

    public static void Map(WebApplication app)
    {
        app.MapGet("/api/inicio/prioridades", Priorities).RequireAuthorization();
        var agenda = app.Module("agenda");
        agenda.MapGet("/seguimiento", ScheduleOverview);
        agenda.MapGet("/{id:int}/cambios", AgendaHistory);
        var notices = app.Module("notificaciones");
        notices.MapGet("/preferencias", async (ClaimsPrincipal user, CrmDb db) => Results.Ok(await Preference(user, db)));
        notices.MapPut("/preferencias", SavePreference);
        notices.MapGet("/metricas", NoticeMetrics);
    }

    public static async Task<NoticePreference> Preference(ClaimsPrincipal user, CrmDb db) =>
        await db.NoticePreferences.FindAsync(user.UserId()) ?? new NoticePreference { AccountId = user.UserId() };

    public static bool Quiet(NoticePreference prefs, DateTimeOffset now)
    {
        var hour = TimeZoneInfo.ConvertTime(now, Mexico).Hour;
        return prefs.QuietFrom < prefs.QuietUntil ? hour >= prefs.QuietFrom && hour < prefs.QuietUntil :
            prefs.QuietFrom > prefs.QuietUntil && (hour >= prefs.QuietFrom || hour < prefs.QuietUntil);
    }

    private static async Task<IResult> SavePreference(PreferenceInput input, ClaimsPrincipal user, CrmDb db)
    {
        if (input.QuietFrom is < 0 or > 23 || input.QuietUntil is < 0 or > 23 || input.EscalationHours is < 2 or > 168 ||
            input.Priority is not ("Actividades" or "Comercial" or "Inventario"))
            return Error("Selecciona horarios válidos y un plazo de escalamiento de 2 a 168 horas.");
        var account = user.UserId();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "NoticePreferences" ("AccountId","QuietFrom","QuietUntil","EscalationHours","Priority")
            VALUES ({account},{input.QuietFrom},{input.QuietUntil},{input.EscalationHours},{input.Priority})
            ON CONFLICT ("AccountId") DO UPDATE SET "QuietFrom"=EXCLUDED."QuietFrom","QuietUntil"=EXCLUDED."QuietUntil",
                "EscalationHours"=EXCLUDED."EscalationHours","Priority"=EXCLUDED."Priority"
            """);
        return Results.NoContent();
    }

    private static async Task<IResult> NoticeMetrics(ClaimsPrincipal user, CrmDb db)
    {
        var cutoff = DateTimeOffset.UtcNow.AddDays(-7);
        var result = await db.NoticeReceipts.Where(x => x.AccountId == user.UserId() && x.ReadAt >= cutoff && x.Group != "")
            .GroupBy(x => x.Group).Select(g => new { group = g.Key, read = g.Count(),
                meanHours = g.Average(x => (double?)x.AcknowledgementSeconds) / 3600 }).ToListAsync();
        return Results.Ok(result);
    }

    private static async Task<IResult> AgendaHistory(int id, ClaimsPrincipal user, CrmDb db)
    {
        var item = await db.AgendaItems.FindAsync(id);
        if (item is null || !user.CanSee(item.OwnerId)) return Results.NotFound();
        return Results.Ok(await db.AgendaChanges.Where(x => x.AgendaId == id).OrderByDescending(x => x.At).Take(30).ToListAsync());
    }

    private static async Task<IResult> ScheduleOverview(int? responsable, int? excluir, ClaimsPrincipal user, CrmDb db)
    {
        var owner = responsable ?? user.UserId();
        if (!user.CanSee(owner)) return Results.Forbid();
        var now = DateTimeOffset.UtcNow;
        var recent = await db.AgendaChanges.Where(x => x.OwnerId == owner && x.Kind == "Completada" && x.At >= now.AddDays(-7))
            .Select(x => new { x.AgendaId, x.Due, x.At }).ToListAsync();
        var completed = recent.GroupBy(x => x.AgendaId).Select(x => x.MaxBy(e => e.At)!).ToArray();
        var pending = await db.AgendaItems.Where(x => x.OwnerId == owner && x.Status == "Pendiente" && x.Id != excluir &&
            x.Due >= now.AddMinutes(-29) && x.Due <= now.AddDays(10)).Select(x => x.Due).ToListAsync();

        var slots = Enumerable.Range(0, 8).SelectMany(days =>
        {
            var date = Today().AddDays(days);
            if (date.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday) return Enumerable.Empty<DateTimeOffset>();
            return Enumerable.Range(9, 8).Select(hour =>
            {
                var local = date.ToDateTime(new TimeOnly(hour, 0));
                return new DateTimeOffset(local, Mexico.GetUtcOffset(local)).ToUniversalTime();
            });
        }).Where(slot => slot > now && !pending.Any(other => Math.Abs((other - slot).TotalMinutes) < 30))
            .OrderBy(slot => pending.Count(other => LocalDate(other) == LocalDate(slot))).ThenBy(slot => slot).Take(4);
        return Results.Ok(new { completed = completed.Length, onTime = completed.Count(x => x.At <= x.Due),
            resolvedLate = completed.Count(x => x.At > x.Due), slots });
    }

    private static DateOnly LocalDate(DateTimeOffset time) => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(time, Mexico).DateTime);

    private static async Task<IResult> Priorities(ClaimsPrincipal user, CrmDb db)
    {
        var now = DateTimeOffset.UtcNow;
        var owner = user.UserId();
        var enabled = await WorkEndpoints.Enabled(user, db);
        var rows = new List<Priority>();
        if (enabled.Contains("agenda"))
        {
            var tasks = await (from task in db.AgendaItems
                join op in db.Opportunities on task.OpportunityId equals (int?)op.Id into related
                from op in related.DefaultIfEmpty()
                where task.OwnerId == owner && task.Status == "Pendiente" && task.Due <= now.AddDays(7)
                orderby task.Due select new { task.Id, task.Title, task.Due,
                    Value = op != null && op.OwnerId == owner ? op.Value : 0 }).Take(100).ToListAsync();
            rows.AddRange(tasks.Select(x =>
            {
                var reason = x.Due <= now ? "Actividad vencida" : x.Due < now.AddDays(1) ? "Vence en menos de un día" : "Actividad próxima";
                var score = (x.Due <= now ? 70 : x.Due < now.AddDays(1) ? 45 : 20) + Math.Min(25, (int)(x.Value / 2000));
                return new Priority(x.Id, x.Title, reason + (x.Value > 0 ? " · oportunidad comercial vinculada" : ""),
                    "/agenda", score, x.Due, x.Value);
            }));
        }
        if (enabled.Contains("inventario") && (user.IsManager() || user.IsInRole("Inventario")))
        {
            var stock = await db.Products.Where(x => x.Active && x.Stock <= x.Minimum)
                .OrderBy(x => x.Stock).Take(20).Select(x => new { x.Id, x.Name, x.Stock, x.Minimum }).ToListAsync();
            rows.AddRange(stock.Select(x => new Priority(x.Id, x.Name, $"Inventario: {x.Stock} disponibles de un mínimo de {x.Minimum}",
                "/inventario", x.Stock == 0 ? 90 : 50, null, 0)));
        }
        var cutoff = now.AddDays(-7);
        var resolved = enabled.Contains("agenda") ? await db.AgendaChanges
            .Where(x => x.OwnerId == owner && x.Kind == "Completada" && x.At >= cutoff && x.At > x.Due)
            .Select(x => x.AgendaId).Distinct().CountAsync() : 0;
        return Results.Ok(new { resolved, items = rows.OrderByDescending(x => x.Score).ThenBy(x => x.Due).Take(10) });
    }

    private sealed record PreferenceInput(int QuietFrom, int QuietUntil, int EscalationHours, string Priority);
    private sealed record Priority(int Id, string Title, string Reason, string Route, int Score, DateTimeOffset? Due, decimal Value);
}
