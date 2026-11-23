using System.Security.Claims;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using static NexoCrm.CrmRules;

namespace NexoCrm;

internal static class CommerceImprovements
{
    public static void Map(WebApplication app)
    {
        var quotes = app.Module("cotizaciones");
        quotes.MapGet("/{id:int}/versiones", Versions);
        quotes.MapPut("/{id:int}/aprobacion", Approve).RequireAuthorization(p => p.RequireRole(Managers));
        var sales = app.Module("ventas");
        sales.MapGet("/{id:int}/entregas", Fulfillments);
        sales.MapPost("/{id:int}/entregas", Fulfill);
        sales.MapGet("/entregas/indicadores", FulfillmentMetrics);
    }

    public static string Pricing(Quote quote) => JsonSerializer.Serialize(new
    {
        quote.PartyId, quote.TaxRate,
        lines = quote.Lines.OrderBy(x => x.Position).Select(x => new { x.ProductId, x.Product, x.Quantity, x.Price, x.Discount })
    });

    public static QuoteVersion Capture(Quote quote, string actor)
    {
        var discount = quote.Lines.Select(x => x.Discount).DefaultIfEmpty().Max();
        return new QuoteVersion
        {
            QuoteId = quote.Id, Revision = quote.Revision, Actor = actor, Total = quote.Total, MaxDiscount = discount,
            Approval = discount > 0 ? "Pendiente" : "No requerida",
            Snapshot = JsonSerializer.Serialize(new { quote.PartyId, quote.Terms, quote.Notes, quote.ValidUntil, quote.TaxRate,
                quote.Subtotal, quote.Tax, quote.Total, quote.Lines }, JsonSerializerOptions.Web)
        };
    }

    private static async Task<IResult> Versions(int id, ClaimsPrincipal user, CrmDb db)
    {
        var quote = await db.Quotes.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id && !x.IsDirectSale);
        if (quote is null || !user.CanSee(quote.OwnerId)) return Results.NotFound();
        var history = await db.QuoteVersions.Where(x => x.QuoteId == id).OrderByDescending(x => x.Id).Take(50).ToListAsync();
        var legacy = history.Count == 0;
        if (legacy) history.Add(Capture(quote, "Versión existente"));
        return Results.Ok(new { quote.Status, legacy, revision = quote.Revision, versions = history.Select(x => new
        {
            x.Id, x.At, x.Actor, x.Total, x.MaxDiscount, x.Approval, x.DecisionBy, x.DecisionReason, x.DecidedAt,
            snapshot = JsonSerializer.Deserialize<JsonElement>(x.Snapshot)
        }) });
    }

    private static async Task<IResult> Approve(int id, ApprovalInput input, ClaimsPrincipal user, CrmDb db)
    {
        if (input.Decision is not ("Aprobada" or "Rechazada") || !Text(input.Reason, 300, true))
            return Error("Selecciona una decisión y registra su motivo.");
        var quote = await db.Quotes.FindAsync(id);
        if (quote is null || quote.IsDirectSale) return Results.NotFound();
        if (quote.Status != "Borrador" || quote.Revision != input.Revision)
            return Conflict("La cotización cambió. Revisa su versión más reciente.");
        var version = await db.QuoteVersions.Where(x => x.QuoteId == id).OrderByDescending(x => x.Id).FirstOrDefaultAsync();
        if (version is null)
        {
            version = Capture(quote, "Versión existente");
            db.QuoteVersions.Add(version);
        }
        if (version.Approval != "Pendiente") return Conflict("Esta versión no tiene una solicitud pendiente.");
        version.Approval = input.Decision;
        version.DecisionBy = user.Identity!.Name!;
        version.DecisionReason = Clean(input.Reason);
        version.DecidedAt = DateTimeOffset.UtcNow;
        quote.Revision = Guid.NewGuid();
        WorkEndpoints.Log(db, quote.PartyId, "Cotización", $"Descuento en COT-{id:D4} · {input.Decision}. {version.DecisionReason}", user);
        await db.SaveChangesAsync();
        return Results.NoContent();
    }

    public static async Task<bool> CanSend(Quote quote, CrmDb db)
    {
        if (quote.Lines.All(x => x.Discount == 0)) return true;
        var approval = await db.QuoteVersions.Where(x => x.QuoteId == quote.Id).OrderByDescending(x => x.Id)
            .Select(x => x.Approval).FirstOrDefaultAsync();
        return approval == "Aprobada";
    }

    private static async Task<IResult> Fulfillments(int id, ClaimsPrincipal user, CrmDb db)
    {
        var sale = await db.Sales.Include(x => x.Document).SingleOrDefaultAsync(x => x.Id == id);
        if (sale is null || !user.CanSee(sale.Document.OwnerId)) return Results.NotFound();
        return Results.Ok(await db.Fulfillments.Where(x => x.SaleId == id).OrderByDescending(x => x.Id).ToListAsync());
    }

    private static async Task<IResult> Fulfill(int id, FulfillmentInput input, ClaimsPrincipal user, CrmDb db)
    {
        if (input.Kind is not ("Entrega" or "Devolución") || input.Quantity < 1 || input.RequestId == Guid.Empty ||
            !Text(input.Reason, 300, true) || input.EffectiveOn > Today() ||
            (input.Kind == "Entrega" && !input.PromisedOn.HasValue))
            return Error("Indica la partida, cantidad, fecha efectiva, motivo y la fecha prometida para entregas.");
        var sale = await db.Sales.Include(x => x.Document).SingleOrDefaultAsync(x => x.Id == id);
        if (sale is null || !user.CanSee(sale.Document.OwnerId)) return Results.NotFound();
        if (input.Kind == "Devolución" && !user.IsManager()) return Results.Forbid();
        var existing = await db.Fulfillments.SingleOrDefaultAsync(x => x.SaleId == id && x.RequestId == input.RequestId);
        if (existing is not null) return Results.Ok(new { existing.Id });
        if (sale.Status == "Cancelada" || input.EffectiveOn < sale.Date)
            return Conflict("La fecha o el estado de la venta impiden registrar el movimiento.");
        var line = sale.Document.Lines.SingleOrDefault(x => x.Position == input.Position);
        if (line is null) return Error("Selecciona una partida de la venta.");
        var events = await db.Fulfillments.Where(x => x.SaleId == id && x.Position == line.Position).ToListAsync();
        var delivered = events.Where(x => x.Kind == "Entrega").Sum(x => x.Quantity);
        var returned = events.Where(x => x.Kind == "Devolución").Sum(x => x.Quantity);
        var allowed = input.Kind == "Entrega" ? line.Quantity - delivered : delivered - returned;
        if (input.Quantity > allowed) return Conflict($"Cantidad máxima para este movimiento: {allowed}.");

        var received = new Fulfillment { SaleId = id, Position = line.Position, Kind = input.Kind, Quantity = input.Quantity,
            Reason = Clean(input.Reason), EffectiveOn = input.EffectiveOn,
            PromisedOn = input.Kind == "Entrega" ? input.PromisedOn : null,
            Actor = user.Identity!.Name!, RequestId = input.RequestId };
        if (input.Kind == "Devolución" && line.ProductId is int productId)
        {
            var product = await db.Products.FindAsync(productId);
            if (product is null || product.Stock + (long)input.Quantity > int.MaxValue)
                return Conflict("La devolución excede el límite de existencias.");
            StockEndpoints.AddMovement(db, product, input.Quantity, "Devolución", received.Reason, user, sale);
        }
        db.Fulfillments.Add(received);
        sale.Revision = Guid.NewGuid();
        db.SaleEvents.Add(new SaleEvent { Sale = sale, Actor = received.Actor, Status = sale.Status,
            Description = $"{received.Kind} de {received.Quantity} unidades de {line.Product}. {received.Reason}" });
        await db.SaveChangesAsync();
        return Results.Ok(new { received.Id });
    }

    private static async Task<IResult> FulfillmentMetrics(ClaimsPrincipal user, CrmDb db)
    {
        var fromDate = Today().AddDays(-89);
        var rows = await (from entry in db.Fulfillments
            join sale in db.Sales on entry.SaleId equals sale.Id
            join quote in db.Quotes on sale.QuoteId equals quote.Id
            where entry.EffectiveOn >= fromDate && (user.IsManager() || quote.OwnerId == user.UserId())
            select new { entry.Kind, entry.PromisedOn, entry.EffectiveOn, entry.Position, entry.Quantity, QuoteId = quote.Id }).ToListAsync();
        var returns = rows.Where(x => x.Kind == "Devolución").ToArray();
        var ids = returns.Select(x => x.QuoteId).Distinct().ToArray();
        var documents = await db.Quotes.AsNoTracking().Where(x => ids.Contains(x.Id)).ToDictionaryAsync(x => x.Id);
        return Results.Ok(new { fromDate, deliveries = rows.Count(x => x.Kind == "Entrega"),
            onTime = rows.Count(x => x.Kind == "Entrega" && x.EffectiveOn <= x.PromisedOn),
            returns = returns.GroupBy(x => documents[x.QuoteId].Lines.Single(y => y.Position == x.Position).Product)
                .Select(g => new { name = g.Key, quantity = g.Sum(x => x.Quantity) }).OrderByDescending(x => x.quantity) });
    }

    private sealed record ApprovalInput(Guid Revision, string Decision, string? Reason);
    private sealed record FulfillmentInput(int Position, int Quantity, string Kind, string? Reason,
        DateOnly EffectiveOn, DateOnly? PromisedOn, Guid RequestId);
}
