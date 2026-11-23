using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using static NexoCrm.CrmRules;

namespace NexoCrm;

internal static class SupplyImprovements
{
    public static void Map(WebApplication app)
    {
        app.Module("inventario").MapGet("/reposicion", Replenishment)
            .RequireAuthorization(p => p.RequireRole("Administrador", "Gerente", "Inventario"));
        var suppliers = app.Module("proveedores");
        suppliers.MapGet("/comparar", Compare);
        suppliers.MapPut("/condiciones", SaveTerms).RequireAuthorization(p => p.RequireRole(SuppliersEditors));
        suppliers.MapGet("/ordenes", Purchases);
        suppliers.MapPost("/ordenes", Draft).RequireAuthorization(p => p.RequireRole(SuppliersEditors));
        suppliers.MapPut("/ordenes/{id:int}/estado", ChangePurchase).RequireAuthorization(p => p.RequireRole(SuppliersEditors));
    }

    private static async Task<IResult> Replenishment(CrmDb db)
    {
        const int window = 60;
        var today = Today();
        var cutoff = new DateTimeOffset(today.AddDays(-window + 1).ToDateTime(TimeOnly.MinValue), TimeSpan.FromHours(-6)).ToUniversalTime();
        var products = await db.Products.Where(x => x.Active).OrderBy(x => x.Name).ToListAsync();
        var movement = await db.StockEntries.Where(x => x.At >= cutoff).OrderBy(x => x.At).ThenBy(x => x.Id)
            .Select(x => new { x.ProductId, x.Type, x.Delta, x.At, x.Balance }).ToListAsync();
        var firstObserved = await db.StockEntries.GroupBy(x => x.ProductId)
            .Select(g => new { Id = g.Key, At = g.Min(x => x.At) }).ToDictionaryAsync(x => x.Id, x => x.At);
        var validTerms = await Options(db).ToListAsync();
        var incoming = await db.PurchaseDrafts.Where(x => x.Status == "Aprobada")
            .GroupBy(x => x.ProductId).Select(x => new { ProductId = x.Key, Quantity = x.Sum(y => (long)y.Quantity) })
            .ToDictionaryAsync(x => x.ProductId, x => x.Quantity);
        var byProduct = movement.ToLookup(x => x.ProductId);
        var timeZone = TimeZoneInfo.FindSystemTimeZoneById("America/Mexico_City");

        var result = products.Select(p =>
        {
            var events = byProduct[p.Id].ToArray();
            var available = events.Length > 0 ? events[0].Balance - (long)events[0].Delta : p.Stock;
            var turnover = (decimal)Math.Max(0, -events.Where(x => x.Type is "Venta" or "Devolución").Sum(x => (long)x.Delta)) / window;
            var best = validTerms.Where(x => x.ProductId == p.Id).OrderBy(x => x.LeadDays).ThenBy(x => x.Cost).FirstOrDefault();
            var pending = incoming.GetValueOrDefault(p.Id);
            var desired = Math.Max(p.Minimum, (long)Math.Ceiling(turnover * ((best?.LeadDays ?? 0) + 14)));
            var days = turnover > 0 ? (int)Math.Min(36500, Math.Floor(p.Stock / turnover)) : (int?)null;
            DateOnly? orderOn = best is null ? null : today.AddDays(Math.Max(0, (days ?? 0) - best.LeadDays));
            var target = Math.Max(0, desired - p.Stock - pending);
            var firstDay = firstObserved.TryGetValue(p.Id, out var observedAt)
                ? DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(observedAt, timeZone).DateTime) : (DateOnly?)null;
            var recentStockout = 0;
            var previousStockout = 0;
            var split = today.AddDays(-29);
            var cursor = 0;
            for (var date = today.AddDays(-window + 1); date <= today; date = date.AddDays(1))
            {
                while (cursor < events.Length && DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(events[cursor].At, timeZone).DateTime) <= date)
                    available = events[cursor++].Balance;
                if (!firstDay.HasValue || date < firstDay || available > 0) continue;
                if (date >= split) recentStockout++;
                else previousStockout++;
            }
            return new { p.Id, p.Name, p.Sku, p.Stock, p.Minimum, incoming = pending, dailyDemand = Math.Round(turnover, 2),
                coverageDays = days, recentStockoutDays = firstDay.HasValue ? recentStockout : (int?)null,
                previousStockoutDays = firstDay < split ? previousStockout : (int?)null, suggestedQuantity = Math.Min(1_000_000, target),
                suggestedOn = target > 0 ? orderOn : null, leadDays = best?.LeadDays, supplier = best?.Supplier, window };
        });
        return Results.Ok(result.OrderByDescending(x => x.suggestedQuantity > 0).ThenBy(x => x.coverageDays ?? int.MaxValue));
    }

    private static IQueryable<Option> Options(CrmDb db) =>
        from term in db.SupplyTerms
        join existing in db.SupplierItems on new { term.SupplierId, term.ProductId } equals new { existing.SupplierId, existing.ProductId }
        join supplier in db.Suppliers on term.SupplierId equals supplier.Id
        join product in db.Products on term.ProductId equals product.Id
        where supplier.Active && product.Active
        select new Option { SupplierId = term.SupplierId, ProductId = term.ProductId, Supplier = supplier.Name,
            Cost = term.Cost, LeadDays = term.LeadDays };

    private static async Task<IResult> Compare(int producto, int? cantidad, CrmDb db)
    {
        var quantity = cantidad ?? 1;
        if (quantity is < 1 or > 1_000_000) return Error("Indica una cantidad de 1 a 1 000 000.");
        var offers = await Options(db).Where(x => x.ProductId == producto).ToListAsync();
        var stats = await db.PurchaseDrafts.Where(x => x.ProductId == producto)
            .Select(x => new { x.SupplierId, x.Status, x.Due, x.Received }).ToListAsync();
        var today = Today();
        return Results.Ok(offers.Select(offer => new
        {
            offer.SupplierId, offer.Supplier, offer.Cost, offer.LeadDays, total = Round(offer.Cost * quantity),
            received = stats.Count(x => x.SupplierId == offer.SupplierId && x.Received.HasValue),
            onTime = stats.Count(x => x.SupplierId == offer.SupplierId && x.Received <= x.Due),
            overdue = stats.Count(x => x.SupplierId == offer.SupplierId && x.Status == "Aprobada" && x.Due < today)
        }).OrderBy(x => x.total).ThenBy(x => x.LeadDays));
    }

    private static async Task<IResult> SaveTerms(TermInput input, CrmDb db)
    {
        if (input.Cost is < .01m or > 1_000_000 || input.LeadDays is < 1 or > 365)
            return Error("Indica costo positivo y plazo de 1 a 365 días.");
        if (!await db.SupplierItems.AnyAsync(x => x.SupplierId == input.SupplierId && x.ProductId == input.ProductId))
            return Conflict("Vincula primero el producto al proveedor.");
        var cost = Round(input.Cost);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "SupplyTerms" ("SupplierId","ProductId","Cost","LeadDays")
            VALUES ({input.SupplierId},{input.ProductId},{cost},{input.LeadDays})
            ON CONFLICT ("SupplierId","ProductId") DO UPDATE SET "Cost"=EXCLUDED."Cost","LeadDays"=EXCLUDED."LeadDays"
            """);
        return Results.NoContent();
    }

    private static async Task<IResult> Purchases(CrmDb db) => Results.Ok(await (
        from order in db.PurchaseDrafts
        join product in db.Products on order.ProductId equals product.Id
        join supplier in db.Suppliers on order.SupplierId equals supplier.Id
        orderby order.Id descending
        select new { order.Id, order.Status, order.Quantity, order.UnitCost, order.Due, order.Received,
            product = product.Name, supplier = supplier.Name }).Take(100).ToListAsync());

    private static async Task<IResult> Draft(DraftInput input, ClaimsPrincipal user, CrmDb db)
    {
        if (input.Quantity is < 1 or > 1_000_000) return Error("Indica una cantidad de 1 a 1 000 000.");
        var option = await Options(db).SingleOrDefaultAsync(x => x.SupplierId == input.SupplierId && x.ProductId == input.ProductId);
        if (option is null) return Conflict("Registra las condiciones de un proveedor activo.");
        var order = new PurchaseDraft { SupplierId = input.SupplierId, ProductId = input.ProductId, Quantity = input.Quantity,
            UnitCost = option.Cost, Due = Today().AddDays(option.LeadDays), Actor = user.Identity!.Name! };
        db.PurchaseDrafts.Add(order);
        await db.SaveChangesAsync();
        return Results.Ok(new { order.Id });
    }

    private static async Task<IResult> ChangePurchase(int id, PurchaseInput input, ClaimsPrincipal user, CrmDb db)
    {
        var order = await db.PurchaseDrafts.FindAsync(id);
        if (order is null) return Results.NotFound();
        var transition = (order.Status, input.Status);
        if (transition is not (("Borrador", "Aprobada") or ("Borrador", "Cancelada") or ("Aprobada", "Recibida") or ("Aprobada", "Cancelada")))
            return Conflict("La orden no admite ese cambio.");
        var product = await db.Products.FindAsync(order.ProductId);
        if (input.Status == "Aprobada")
        {
            var condition = await Options(db).SingleOrDefaultAsync(x => x.SupplierId == order.SupplierId && x.ProductId == order.ProductId);
            if (condition is null) return Conflict("Verifica que el proveedor, el producto y sus condiciones sigan activos.");
            order.Due = Today().AddDays(condition.LeadDays);
        }
        if (input.Status == "Recibida")
        {
            if (product is not { Active: true } || product.Stock + (long)order.Quantity > int.MaxValue)
                return Conflict("No se puede registrar esta entrada de inventario.");
            StockEndpoints.AddMovement(db, product, order.Quantity, "Entrada", $"Recepción de OC-{id:D4}.", user);
            order.Received = Today();
        }
        order.Status = input.Status;
        await db.SaveChangesAsync();
        return Results.NoContent();
    }

    private sealed class Option
    {
        public int SupplierId { get; init; }
        public int ProductId { get; init; }
        public required string Supplier { get; init; }
        public decimal Cost { get; init; }
        public int LeadDays { get; init; }
    }
    private sealed record TermInput(int SupplierId, int ProductId, decimal Cost, int LeadDays);
    private sealed record DraftInput(int SupplierId, int ProductId, int Quantity);
    private sealed record PurchaseInput(string Status);
}
