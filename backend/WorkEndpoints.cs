using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using static NexoCrm.CrmRules;

namespace NexoCrm;

public static class WorkEndpoints
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/inicio", Home).RequireAuthorization();
        app.MapGet("/api/buscar", WorkspaceSearch.Find).RequireAuthorization();
        app.MapGet("/api/inicio/panel", HomeDashboard.Get).RequireAuthorization();
        var agenda = app.Module("agenda");
        agenda.MapGet("", async (ClaimsPrincipal user, CrmDb db) =>
            Results.Ok(await AgendaRows(VisibleTasks(user, db), db).ToListAsync()));
        agenda.MapGet("/responsables", async (ClaimsPrincipal user, CrmDb db) =>
        {
            var id = user.UserId();
            var manager = user.IsManager();
            return Results.Ok(await db.Accounts.Where(x => x.Active && (manager || x.Id == id))
                .OrderBy(x => x.Name).Select(x => new { x.Id, x.Name }).ToListAsync());
        });
        agenda.MapPost("", (AgendaInput input, ClaimsPrincipal user, CrmDb db) => SaveAgenda(null, input, user, db));
        agenda.MapPut("/{id:int}", (int id, AgendaInput input, ClaimsPrincipal user, CrmDb db) => SaveAgenda(id, input, user, db));

        var history = app.Module("historial");
        history.MapGet("", History);
        history.MapPost("/comentarios", Comment);

        var notices = app.Module("notificaciones");
        notices.MapGet("", async (ClaimsPrincipal user, CrmDb db) =>
            Results.Ok(await ListNotices(user, await Enabled(user, db), db)));
        notices.MapPut("/{key}/leida", ReadNotice);
    }

    private static IQueryable<AgendaItem> VisibleTasks(ClaimsPrincipal user, CrmDb db)
    {
        var actor = user.UserId();
        var manager = user.IsManager();
        return db.AgendaItems.AsNoTracking().Where(x => manager || x.OwnerId == actor);
    }

    private static IQueryable<AgendaRow> AgendaRows(IQueryable<AgendaItem> tasks, CrmDb db)
    {
        return from task in tasks
            join account in db.Accounts on task.OwnerId equals account.Id
            join party in db.Parties on task.PartyId equals (int?)party.Id into parties
            from party in parties.DefaultIfEmpty()
            orderby task.Due
            select new AgendaRow(task.Id, task.Title, task.Description, task.Type, task.Status, task.Due,
                account.Id, account.Name, task.PartyId, party == null ? null : party.Name, task.OpportunityId, task.QuoteId);
    }

    private static async Task<IResult> SaveAgenda(int? id, AgendaInput input, ClaimsPrincipal user, CrmDb db)
    {
        if (!Text(input.Title, 120, true) || !Text(input.Description, 650) || input.Due.Year is < 2000 or > 2100 ||
            input.Type is not ("Llamada" or "Reunión" or "Seguimiento" or "Tarea") ||
            input.Status is not ("Pendiente" or "Completada" or "Cancelada"))
            return Error("Revisa el título, fecha, tipo y estado de la actividad.");

        var task = id.HasValue ? await db.AgendaItems.FindAsync(id.Value) : new AgendaItem { OwnerId = user.UserId() };
        if (task is null || !user.CanSee(task.OwnerId)) return Results.NotFound();
        var owner = input.OwnerId ?? task.OwnerId;
        if (!user.IsManager() && owner != user.UserId()) return Results.Forbid();
        var assignee = await db.Accounts.FindAsync(owner);
        if (assignee is not { Active: true }) return Error("Selecciona un responsable activo.");

        Party? party = null;
        if (input.PartyId.HasValue)
        {
            var modules = await Enabled(user, db);
            if (!modules.Contains("clientes")) return Results.Forbid();
            party = await db.Parties.FindAsync(input.PartyId.Value);
            if (party is null || !user.CanSee(party.OwnerId)) return Results.NotFound();
            if (!Managers.Contains(assignee.Role) && (assignee.Role != "Vendedor" || party.OwnerId != owner))
                return Error("El responsable necesita acceso a la ficha vinculada.");
            if (input.OpportunityId.HasValue && !await db.Opportunities.AnyAsync(x =>
                x.Id == input.OpportunityId && x.PartyId == party.Id))
                return Error("La oportunidad debe pertenecer a la ficha seleccionada.");
            if (input.QuoteId.HasValue && (!modules.Contains("cotizaciones") || !await db.Quotes.AnyAsync(x =>
                x.Id == input.QuoteId && x.PartyId == party.Id && !x.IsDirectSale &&
                (user.IsManager() || x.OwnerId == owner) && (Managers.Contains(assignee.Role) || x.OwnerId == owner))))
                return Error("Selecciona una cotización visible para el responsable.");
        }
        else if (input.OpportunityId.HasValue || input.QuoteId.HasValue)
            return Error("Selecciona la ficha relacionada con la oportunidad o cotización.");

        var before = task.Status;
        var previousDue = task.Due;
        var newDue = input.Due.ToUniversalTime();
        var rescheduled = id.HasValue && previousDue != newDue;
        if (rescheduled && !Text(input.RescheduleReason, 300, true))
            return Error("Indica el motivo de la reprogramación.");
        if (rescheduled)
            db.AgendaChanges.Add(new AgendaChange { AgendaId = task.Id, OwnerId = owner, Due = previousDue, NewDue = newDue,
                Kind = "Reprogramada", Reason = Clean(input.RescheduleReason), Actor = user.Identity!.Name! });
        if (id.HasValue && before != "Completada" && input.Status == "Completada")
            db.AgendaChanges.Add(new AgendaChange { AgendaId = task.Id, OwnerId = owner, Due = newDue,
                Kind = "Completada", Actor = user.Identity!.Name! });
        task.Title = Clean(input.Title);
        task.Description = Clean(input.Description);
        task.Type = input.Type;
        task.Status = input.Status;
        task.Due = input.Due.ToUniversalTime();
        task.OwnerId = owner;
        task.PartyId = input.PartyId;
        task.OpportunityId = input.OpportunityId;
        task.QuoteId = input.QuoteId;
        task.Revision = Guid.NewGuid();
        if (!id.HasValue) db.AgendaItems.Add(task);
        if (party is not null)
        {
            var detail = before != task.Status ? task.Status : id.HasValue ? "Actualizada" : "Programada";
            Log(db, party.Id, "Agenda", rescheduled ? $"Reprogramada · {task.Title}. {Clean(input.RescheduleReason)}" :
                $"{detail} · {task.Type}: {task.Title}", user);
            if (task.OpportunityId.HasValue && task.Status == "Completada" && before != task.Status)
            {
                var opportunity = (await db.Opportunities.FindAsync(task.OpportunityId.Value))!;
                opportunity.UpdatedAt = DateTimeOffset.UtcNow;
                opportunity.Revision = Guid.NewGuid();
            }
        }
        await db.SaveChangesAsync();
        return Results.Ok(new { task.Id });
    }

    public static void Log(CrmDb db, int partyId, string type, string description, ClaimsPrincipal user)
        => db.HistoryEntries.Add(new HistoryEntry { PartyId = partyId, Type = type, Description = description,
            Actor = user.Identity!.Name! });

    private static async Task<IResult> Comment(CommentInput input, ClaimsPrincipal user, CrmDb db)
    {
        if (!Text(input.Text, 650, true) || input.Type is not ("Comentario" or "Llamada" or "Reunión"))
            return Error("Escribe un comentario de hasta 650 caracteres y selecciona un tipo.");
        var party = await db.Parties.FindAsync(input.PartyId);
        if (party is null || !user.CanSee(party.OwnerId)) return Results.NotFound();
        Log(db, party.Id, input.Type, Clean(input.Text), user);
        await db.SaveChangesAsync();
        return Results.NoContent();
    }

    private static async Task<IResult> History(int? ficha, string? tipo, string? autor, DateTimeOffset? desde,
        DateTimeOffset? hasta, ClaimsPrincipal user, CrmDb db)
    {
        if (desde > hasta || !Text(tipo, 40) || !Text(autor, 150)) return Error("Revisa los filtros del historial.");
        return Results.Ok(await HistoryRows(ficha, user, await Enabled(user, db), db, 150,
            Clean(tipo), Clean(autor), desde?.ToUniversalTime(), hasta?.ToUniversalTime()));
    }

    private static async Task<List<HistoryRow>> HistoryRows(int? partyId, ClaimsPrincipal user,
        HashSet<string> modules, CrmDb db, int limit, string type = "", string actor = "",
        DateTimeOffset? since = null, DateTimeOffset? until = null)
    {
        var owner = user.UserId();
        var manager = user.IsManager();
        var parties = db.Parties.Where(x => (!partyId.HasValue || x.Id == partyId) && (manager || x.OwnerId == owner));
        var changes = await (from entry in db.HistoryEntries.AsNoTracking()
            join party in parties on entry.PartyId equals party.Id
            where (type == "" || entry.Type == type) && (actor == "" || EF.Functions.ILike(entry.Actor, "%" + actor + "%")) &&
                (!since.HasValue || entry.At >= since) && (!until.HasValue || entry.At < until)
            orderby entry.At descending
            select new HistoryRow("ficha-" + entry.Id, party.Id, party.Name, entry.Type, entry.Description, entry.Actor, entry.At))
            .Take(limit).ToListAsync();
        if (modules.Contains("ventas") && type is "" or "Venta")
        {
            var sales = await (from entry in db.SaleEvents.AsNoTracking()
                join sale in db.Sales on entry.SaleId equals sale.Id
                join quote in db.Quotes on sale.QuoteId equals quote.Id
                join party in parties on quote.PartyId equals party.Id
                where (manager || quote.OwnerId == owner) && (actor == "" || EF.Functions.ILike(entry.Actor, "%" + actor + "%")) &&
                    (!since.HasValue || entry.At >= since) && (!until.HasValue || entry.At < until)
                orderby entry.At descending
                select new HistoryRow("venta-" + entry.Id, party.Id, party.Name, "Venta",
                    entry.Status + " · " + entry.Description, entry.Actor, entry.At)).Take(limit).ToListAsync();
            changes.AddRange(sales);
        }
        return changes.OrderByDescending(x => x.At).Take(limit).ToList();
    }

    private static async Task<IResult> Home(ClaimsPrincipal user, CrmDb db, bool? includeNotices)
    {
        var modules = await Enabled(user, db);
        var owner = user.UserId();
        var manager = user.IsManager();
        var now = DateTimeOffset.UtcNow;
        var today = Today();
        var tasks = db.AgendaItems.AsNoTracking().Where(x => x.OwnerId == owner && x.Status == "Pendiente");
        var quotes = db.Quotes.Where(x => !x.IsDirectSale && x.Status == "Enviada" &&
            x.ValidUntil >= today && x.ValidUntil <= today.AddDays(7) && (manager || x.OwnerId == owner));
        var opportunities = db.Opportunities.Where(x => x.Stage != "Ganada" && x.Stage != "Perdida" &&
            (manager || x.OwnerId == owner) && db.Parties.Any(p => p.Id == x.PartyId && p.Active));
        return Results.Ok(new
        {
            pending = modules.Contains("agenda") ? await tasks.CountAsync() : 0,
            overdue = modules.Contains("agenda") ? await tasks.CountAsync(x => x.Due < now) : 0,
            openValue = modules.Contains("clientes") ? await opportunities.SumAsync(x => x.Value) : 0,
            expiring = modules.Contains("cotizaciones") ? await quotes.CountAsync() : 0,
            lowStock = modules.Contains("inventario") ? await db.Products.CountAsync(x => x.Active && x.Stock <= x.Minimum) : 0,
            tasks = modules.Contains("agenda") ? await AgendaRows(tasks.OrderBy(x => x.Due).Take(5), db).ToListAsync() : [],
            notices = includeNotices != false && modules.Contains("notificaciones") ? (await ListNotices(user, modules, db)).Where(x => !x.Read).Take(4).ToList() : [],
            recent = modules.Contains("historial") ? await HistoryRows(null, user, modules, db, 5) : []
        });
    }

    private static async Task<IResult> ReadNotice(string key, ClaimsPrincipal user, CrmDb db)
    {
        var notices = await ListNotices(user, await Enabled(user, db), db);
        var notice = notices.SingleOrDefault(x => x.Key == key);
        if (notice is null) return Results.NotFound();
        var accountId = user.UserId();
        var now = DateTimeOffset.UtcNow;
        int? seconds = notice.At is { } at && at <= now ? (int)Math.Min(int.MaxValue, (now - at).TotalSeconds) : null;
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "NoticeReceipts" ("AccountId", "Key", "ReadAt", "Group", "AcknowledgementSeconds")
            VALUES ({accountId}, {key}, {now}, {notice.Group}, {seconds})
            ON CONFLICT ("AccountId", "Key") DO NOTHING
            """);
        return Results.NoContent();
    }

    private static async Task<List<Notice>> ListNotices(ClaimsPrincipal user, HashSet<string> modules, CrmDb db)
    {
        var owner = user.UserId();
        var now = DateTimeOffset.UtcNow;
        var today = Today();
        var notices = new List<Notice>();
        if (modules.Contains("agenda"))
        {
            var rows = await db.AgendaItems.Where(x => x.OwnerId == owner && x.Status == "Pendiente")
                .OrderBy(x => x.Due).Take(100).ToListAsync();
            notices.AddRange(rows.Select(x => new Notice($"agenda-{x.Id}-{x.Revision:N}",
                x.Due < now ? "Actividad vencida" : x.Due <= now.AddDays(1) ? "Próxima actividad" : "Actividad asignada",
                x.Title, x.Due, "/agenda", x.Id)));
        }
        if (modules.Contains("cotizaciones"))
        {
            var quotes = await (from quote in db.Quotes
                join party in db.Parties on quote.PartyId equals party.Id
                where quote.OwnerId == owner && !quote.IsDirectSale && quote.Status == "Enviada" &&
                    quote.ValidUntil >= today && quote.ValidUntil <= today.AddDays(7)
                orderby quote.ValidUntil
                select new { quote.Id, party.Name, quote.ValidUntil }).Take(60).ToListAsync();
            notices.AddRange(quotes.Select(x => new Notice($"cotizacion-{x.Id}-{x.ValidUntil.DayNumber}",
                "Cotización por vencer", x.Name, new DateTimeOffset(x.ValidUntil.ToDateTime(new TimeOnly(12, 0)), TimeSpan.FromHours(-6)),
                "/cotizaciones", x.Id)));
        }
        if (modules.Contains("clientes"))
        {
            var stale = now.AddDays(-7);
            var opportunities = await (from entry in db.Opportunities
                join party in db.Parties on entry.PartyId equals party.Id
                where entry.OwnerId == owner && party.OwnerId == owner && party.Active && entry.UpdatedAt <= stale &&
                    entry.Stage != "Ganada" && entry.Stage != "Perdida"
                orderby entry.UpdatedAt
                select new { entry.Id, entry.Description, entry.UpdatedAt, entry.Revision }).Take(60).ToListAsync();
            notices.AddRange(opportunities.Select(x => new Notice($"oportunidad-{x.Id}-{x.Revision:N}",
                "Oportunidad sin seguimiento", x.Description, x.UpdatedAt.AddDays(7), "/oportunidades", x.Id)));
        }
        if (modules.Contains("inventario") && StockEditors.Any(user.IsInRole))
        {
            var products = await db.Products.Where(x => x.Active && x.Stock <= x.Minimum)
                .OrderBy(x => x.Stock).Take(40).ToListAsync();
            notices.AddRange(products.Select(x => new Notice($"inventario-{x.Id}-{x.Revision:N}", "Existencias bajas",
                $"{x.Name} · {x.Stock} disponibles", null, "/inventario", x.Id)));
        }

        if (user.IsManager() && modules.Contains("agenda"))
        {
            var eligible = await (from task in db.AgendaItems
                join account in db.Accounts on task.OwnerId equals account.Id
                join prefs in db.NoticePreferences on task.OwnerId equals prefs.AccountId into options
                from prefs in options.DefaultIfEmpty()
                where task.Status == "Pendiente" && task.OwnerId != owner && account.Active &&
                    task.Due <= now.AddHours(-2) && (task.Type == "Seguimiento" || task.Type == "Reunión")
                orderby task.Due
                select new { task.Id, task.Due, task.Title, task.Revision, Owner = account.Name,
                    Hours = prefs == null ? 48 : prefs.EscalationHours }).Take(150).ToListAsync();
            notices.AddRange(eligible.Where(x => x.Due <= now.AddHours(-x.Hours)).Select(x =>
                new Notice($"escalada-{x.Id}-{x.Revision:N}", "Seguimiento escalado", $"{x.Title} · {x.Owner}",
                    x.Due.AddHours(x.Hours), "/agenda", x.Id, Group: "Gerencia")));
        }
        var preferences = await WorkImprovements.Preference(user, db);
        var quiet = WorkImprovements.Quiet(preferences, now);
        var keys = notices.Select(x => x.Key).ToArray();
        var read = (await db.NoticeReceipts.Where(x => x.AccountId == owner && keys.Contains(x.Key))
            .Select(x => x.Key).ToListAsync()).ToHashSet();
        return notices.Select(x => x with { Read = read.Contains(x.Key),
            Group = x.Group != "" ? x.Group : x.Route == "/agenda" ? "Actividades" : x.Route == "/inventario" ? "Inventario" : "Comercial",
            Muted = quiet && x.Group != "Gerencia" })
            .OrderBy(x => x.Read).ThenByDescending(x => x.Group == "Gerencia").ThenByDescending(x => x.Group == preferences.Priority)
            .ThenBy(x => x.At ?? now).ToList();
    }

    internal static async Task<HashSet<string>> Enabled(ClaimsPrincipal user, CrmDb db)
    {
        var enabled = await db.Modules.Where(x => x.Enabled).Select(x => x.Key).ToListAsync();
        return enabled.Where(key => Modules.TryGetValue(key, out var roles) && roles.Any(user.IsInRole)).ToHashSet();
    }

    private sealed record AgendaInput(string? Title, string? Description, string Type, string Status, DateTimeOffset Due,
        int? OwnerId = null, int? PartyId = null, int? OpportunityId = null, int? QuoteId = null, string? RescheduleReason = null);
    private sealed record CommentInput(int PartyId, string Type, string? Text);
    private sealed record AgendaRow(int Id, string Title, string Description, string Type, string Status,
        DateTimeOffset Due, int OwnerId, string Owner, int? PartyId, string? Party, int? OpportunityId, int? QuoteId);
    private sealed record HistoryRow(string Key, int PartyId, string Party, string Type, string Description, string Actor, DateTimeOffset At);
    private sealed record Notice(string Key, string Title, string Detail, DateTimeOffset? At, string Route, int RecordId, bool Read = false, string Group = "", bool Muted = false);
}
