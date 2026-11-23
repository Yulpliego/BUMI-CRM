using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using static NexoCrm.CrmRules;

namespace NexoCrm;

public static class CommerceEndpoints
{
    public static void Map(WebApplication app)
    {
        var quotes = app.Module("cotizaciones");
        quotes.MapGet("", ListQuotes);
        quotes.MapGet("/destinatarios", async (ClaimsPrincipal user, CrmDb db) => Results.Ok(await db.Parties
            .Where(x => x.Active && (user.IsManager() || x.OwnerId == user.UserId())).OrderBy(x => x.Name)
            .Select(x => new { x.Id, x.Name, x.Kind }).ToListAsync()));
        quotes.MapPost("", (QuoteInput input, ClaimsPrincipal user, CrmDb db) => SaveQuote(null, input, user, db));
        quotes.MapPut("/{id:int}", (int id, QuoteInput input, ClaimsPrincipal user, CrmDb db) => SaveQuote(id, input, user, db));
        quotes.MapPatch("/{id:int}/estado", QuoteStatus);

        var sales = app.Module("ventas");
        sales.MapGet("", ListSales);
        sales.MapGet("/clientes", async (CrmDb db) => Results.Ok(await db.Parties
            .Where(x => x.Active && x.Kind == "Cliente").OrderBy(x => x.Name)
            .Select(x => new { x.Id, x.Name, x.Kind }).ToListAsync()))
            .RequireAuthorization(policy => policy.RequireRole(Managers));
        sales.MapPost("/directa", CreateDirectSale).RequireAuthorization(policy => policy.RequireRole(Managers));
        sales.MapGet("/{id:int}/historial", SaleHistory);
        sales.MapPost("/cotizacion/{id:int}", CreateSale);
        sales.MapPatch("/{id:int}/estado", SaleStatus);
    }

    private static async Task<IResult> ListQuotes(ClaimsPrincipal user, CrmDb db, int? ficha)
    {
        var canSeeAll = user.IsManager();
        var userId = user.UserId();
        var today = Today();
        return Results.Ok(await (from quote in db.Quotes.AsNoTracking()
            join party in db.Parties on quote.PartyId equals party.Id
            join owner in db.Accounts on quote.OwnerId equals owner.Id
            where !quote.IsDirectSale && (canSeeAll || quote.OwnerId == userId) && (!ficha.HasValue || quote.PartyId == ficha)
            orderby quote.Id descending
            select new
            {
                quote.Id, quote.PartyId, party = party.Name, owner = owner.Name, quote.Date, quote.ValidUntil,
                status = quote.Status == "Enviada" && quote.ValidUntil < today ? "Vencida" : quote.Status,
                quote.Terms, quote.Notes, quote.TaxRate, quote.Subtotal, quote.Tax, quote.Total,
                lines = quote.Lines.OrderBy(x => x.Position).ToList(),
                hasSale = db.Sales.Any(x => x.QuoteId == quote.Id)
            }).ToListAsync());
    }

    private static async Task<IResult> SaveQuote(int? id, QuoteInput input, ClaimsPrincipal user, CrmDb db)
    {
        if (input.ValidUntil < Today() || !Text(input.Terms, 500) || !Text(input.Notes, 500) ||
            !ValidLines(input.TaxRate, input.Lines))
            return Error("Revisa la vigencia, los importes y los productos de la cotización.");
        await using var transaction = await db.Database.BeginTransactionAsync();
        var quote = id is null ? new Quote { OwnerId = user.UserId() }
            : await db.Quotes.Include(x => x.Lines).SingleOrDefaultAsync(x => x.Id == id);
        if (quote is null || quote.IsDirectSale || !user.CanSee(quote.OwnerId)) return Results.NotFound();
        if (quote.Status != "Borrador") return Conflict("Solo puedes editar un borrador.");
        var party = await db.Parties.FindAsync(input.PartyId);
        if (party is null || !party.Active || !user.CanSee(party.OwnerId)) return Error("Selecciona un destinatario activo.");

        var previous = id.HasValue
            ? await db.QuoteVersions.Where(x => x.QuoteId == id).OrderByDescending(x => x.Id).FirstOrDefaultAsync()
            : null;
        if (id.HasValue && previous is null)
            db.QuoteVersions.Add(CommerceImprovements.Capture(quote, "Versión existente"));
        var oldTerms = CommerceImprovements.Pricing(quote);
        quote.PartyId = input.PartyId;
        quote.ValidUntil = input.ValidUntil;
        quote.Terms = Clean(input.Terms);
        quote.Notes = Clean(input.Notes);
        quote.Revision = Guid.NewGuid();
        var catalog = await CatalogNames(db, input.Lines);
        if (catalog is null) return Error("Selecciona productos activos del catálogo.");
        SetAmounts(quote, input.TaxRate, input.Lines, catalog);
        WorkEndpoints.Log(db, party.Id, "Cotización", id.HasValue ? $"Cotización COT-{id:D4} actualizada." : "Se creó un borrador de cotización.", user);
        if (id is null) db.Quotes.Add(quote);
        await db.SaveChangesAsync();
        var version = CommerceImprovements.Capture(quote, user.Identity!.Name!);
        if (previous?.Approval == "Aprobada" && version.Approval == "Pendiente" && oldTerms == CommerceImprovements.Pricing(quote))
        {
            version.Approval = previous.Approval;
            version.DecisionBy = previous.DecisionBy;
            version.DecisionReason = previous.DecisionReason;
            version.DecidedAt = previous.DecidedAt;
        }
        db.QuoteVersions.Add(version);
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return Results.Ok(new { quote.Id });
    }

    private static async Task<IResult> QuoteStatus(int id, StatusInput input, ClaimsPrincipal user, CrmDb db)
    {
        var quote = await db.Quotes.FindAsync(id);
        if (quote is null || quote.IsDirectSale || !user.CanSee(quote.OwnerId)) return Results.NotFound();
        var allowed = (quote.Status, input.Status) is ("Borrador", "Enviada") or
            ("Enviada", "Aceptada") or ("Enviada", "Rechazada");
        if (!allowed || quote.ValidUntil < Today()) return Conflict("El estado o la vigencia impiden este cambio.");
        if (input.Status == "Enviada" && !await CommerceImprovements.CanSend(quote, db))
            return Conflict("Una versión con descuento requiere aprobación antes de enviarse.");
        quote.Status = input.Status;
        quote.Revision = Guid.NewGuid();
        WorkEndpoints.Log(db, quote.PartyId, "Cotización", $"COT-{id:D4} · {quote.Status}", user);
        await db.SaveChangesAsync();
        return Results.NoContent();
    }

    private static async Task<IResult> ListSales(ClaimsPrincipal user, CrmDb db)
    {
        var canSeeAll = user.IsManager();
        var userId = user.UserId();
        return Results.Ok(await (from sale in db.Sales.AsNoTracking()
            join quote in db.Quotes on sale.QuoteId equals quote.Id
            join party in db.Parties on quote.PartyId equals party.Id
            join owner in db.Accounts on quote.OwnerId equals owner.Id
            where canSeeAll || quote.OwnerId == userId
            orderby sale.Id descending
            select new
            {
                sale.Id, quoteId = quote.IsDirectSale ? (int?)null : sale.QuoteId, party = party.Name,
                owner = owner.Name, sale.Date, sale.Status,
                sale.CancelReason, sale.CancelledBy, sale.CancelledAt, quote.Subtotal, quote.Tax, quote.Total,
                lines = quote.Lines.OrderBy(x => x.Position).ToList()
            }).ToListAsync());
    }

    private static async Task<IResult> CreateSale(int id, ClaimsPrincipal user, CrmDb db)
    {
        var quote = await db.Quotes.FindAsync(id);
        if (quote is null || quote.IsDirectSale || !user.CanSee(quote.OwnerId)) return Results.NotFound();
        if (quote.Status != "Aceptada") return Conflict("La cotización debe estar aceptada.");
        var party = await db.Parties.FindAsync(quote.PartyId);
        if (party is not { Active: true, Kind: "Cliente" })
            return Conflict("El destinatario debe ser un cliente activo. Convierte al prospecto desde su ficha.");
        if (await db.Sales.AnyAsync(x => x.QuoteId == id)) return Conflict("La cotización ya tiene una venta.");
        var sale = new Sale { QuoteId = id };
        var stockIssue = await StockEndpoints.ApplySale(db, sale, quote, user);
        if (stockIssue is not null) return Conflict(stockIssue);
        db.Sales.Add(sale);
        RecordEvent(db, sale, user, "Venta registrada desde una cotización aceptada.");
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return Conflict("La cotización ya tiene una venta.");
        }
        return Results.Ok(new { sale.Id });
    }

    private static async Task<IResult> SaleStatus(int id, StatusInput input, ClaimsPrincipal user, CrmDb db)
    {
        var sale = await db.Sales.FindAsync(id);
        if (sale is null) return Results.NotFound();
        var quote = (await db.Quotes.FindAsync(sale.QuoteId))!;
        if (!user.CanSee(quote.OwnerId)) return Results.NotFound();

        if (input.Status == "Cancelada")
        {
            if (!user.IsManager()) return Results.Forbid();
            if (sale.Status == "Cancelada" || !Text(input.Reason, 300, true))
                return Error("Indica un motivo para cancelar la venta.");
            var fulfillment = await db.Fulfillments.Where(x => x.SaleId == sale.Id).ToListAsync();
            if (fulfillment.GroupBy(x => x.Position).Any(line => line.Sum(x => x.Kind == "Entrega" ? x.Quantity : -x.Quantity) > 0))
                return Conflict("Registra la devolución de las partidas entregadas antes de cancelar.");
            if (!await StockEndpoints.RestoreSale(db, sale, user))
                return Conflict("La devolución excede el límite de existencias.");
            sale.CancelReason = Clean(input.Reason);
            sale.CancelledBy = user.Identity!.Name!;
            sale.CancelledAt = DateTimeOffset.UtcNow;
        }
        else if ((sale.Status, input.Status) is not (("Registrada", "En proceso") or ("En proceso", "Completada")))
            return Conflict("La venta no admite ese cambio de estado.");

        sale.Status = input.Status;
        sale.Revision = Guid.NewGuid();
        RecordEvent(db, sale, user, sale.Status == "Cancelada" ? sale.CancelReason : "Estado actualizado.");
        await db.SaveChangesAsync();
        return Results.NoContent();
    }

    private static async Task<IResult> CreateDirectSale(DirectSaleInput input, ClaimsPrincipal user, CrmDb db)
    {
        if (!Text(input.Reason, 300, true) || !ValidLines(input.TaxRate, input.Lines))
            return Error("Indica el motivo de autorización y revisa los productos e importes.");
        var party = await db.Parties.FindAsync(input.PartyId);
        if (party is not { Active: true, Kind: "Cliente" }) return Error("Selecciona un cliente activo.");
        var document = new Quote
        {
            IsDirectSale = true, PartyId = party.Id, OwnerId = user.UserId(),
            Status = "Aceptada", ValidUntil = Today()
        };
        var catalog = await CatalogNames(db, input.Lines);
        if (catalog is null) return Error("Selecciona productos activos del catálogo.");
        SetAmounts(document, input.TaxRate, input.Lines, catalog);
        var sale = new Sale { Document = document };
        var stockIssue = await StockEndpoints.ApplySale(db, sale, document, user);
        if (stockIssue is not null) return Conflict(stockIssue);
        db.Sales.Add(sale);
        RecordEvent(db, sale, user, "Venta directa autorizada. " + Clean(input.Reason));
        await db.SaveChangesAsync();
        return Results.Ok(new { sale.Id });
    }

    private static async Task<IResult> SaleHistory(int id, ClaimsPrincipal user, CrmDb db)
    {
        var sale = await db.Sales.Include(x => x.Document).SingleOrDefaultAsync(x => x.Id == id);
        if (sale is null || !user.CanSee(sale.Document.OwnerId)) return Results.NotFound();
        return Results.Ok(await db.SaleEvents.Where(x => x.SaleId == id).OrderByDescending(x => x.Id)
            .Select(x => new { x.Id, x.At, x.Actor, x.Status, x.Description }).ToListAsync());
    }

    private static void RecordEvent(CrmDb db, Sale sale, ClaimsPrincipal user, string description)
        => db.SaleEvents.Add(new SaleEvent { Sale = sale, Actor = user.Identity!.Name!,
            Status = sale.Status, Description = description });

    private static bool ValidLines(decimal rate, LineInput[]? lines) => rate is >= 0 and <= 100 &&
        lines is { Length: >= 1 and <= 50 } && lines.All(x => x is not null && (x.ProductId.HasValue || Text(x.Product, 120, true)) &&
            x.Quantity is >= 1 and <= 10000 && x.Price is >= 0.01m and <= 1_000_000 && x.Discount is >= 0 and <= 100);

    private static async Task<Dictionary<int, string>?> CatalogNames(CrmDb db, LineInput[] lines)
    {
        var ids = lines.Where(x => x.ProductId.HasValue).Select(x => x.ProductId!.Value).Distinct().ToArray();
        var catalog = await db.Products.Where(x => ids.Contains(x.Id) && x.Active).ToDictionaryAsync(x => x.Id, x => x.Name);
        return catalog.Count == ids.Length ? catalog : null;
    }

    private static void SetAmounts(Quote document, decimal rate, LineInput[] lines, Dictionary<int, string> catalog)
    {
        document.TaxRate = Round(rate);
        document.Lines = lines.Select((line, index) => new QuoteLine
        {
            Position = index + 1, ProductId = line.ProductId,
            Product = line.ProductId is int id ? catalog[id] : Clean(line.Product), Quantity = line.Quantity,
            Price = Round(line.Price), Discount = Round(line.Discount)
        }).ToList();
        document.Calculate();
    }

    private sealed record DirectSaleInput(int PartyId, decimal TaxRate, LineInput[] Lines, string? Reason);
    private sealed record QuoteInput(int PartyId, DateOnly ValidUntil, decimal TaxRate, LineInput[] Lines,
        string? Terms = null, string? Notes = null);
    private sealed record LineInput(string? Product, int Quantity, decimal Price, decimal Discount = 0, int? ProductId = null);
    private sealed record StatusInput(string Status, string? Reason = null);
}
