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
        sales.MapPost("/cotizacion/{id:int}", CreateSale);
        sales.MapPatch("/{id:int}/estado", SaleStatus);
    }

    private static async Task<IResult> ListQuotes(ClaimsPrincipal user, CrmDb db)
    {
        var canSeeAll = user.IsManager();
        var userId = user.UserId();
        var today = Today();
        return Results.Ok(await (from quote in db.Quotes.AsNoTracking()
            join party in db.Parties on quote.PartyId equals party.Id
            join owner in db.Accounts on quote.OwnerId equals owner.Id
            where canSeeAll || quote.OwnerId == userId
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
            input.TaxRate is < 0 or > 100 || input.Lines is not { Length: >= 1 and <= 50 } ||
            input.Lines.Any(x => x is null || !Text(x.Product, 120, true) || x.Quantity is < 1 or > 10000 ||
                x.Price is <= 0 or > 1_000_000 || x.Discount is < 0 or > 100))
            return Error("Revisa la vigencia, los importes y los productos de la cotización.");
        if (!user.IsManager() && input.Lines.Any(x => x.Discount > 0))
            return Error("Solo un gerente o administrador puede aplicar descuentos.");

        var quote = id is null ? new Quote { OwnerId = user.UserId() }
            : await db.Quotes.Include(x => x.Lines).SingleOrDefaultAsync(x => x.Id == id);
        if (quote is null || !user.CanSee(quote.OwnerId)) return Results.NotFound();
        if (quote.Status != "Borrador") return Conflict("Solo puedes editar un borrador.");
        var party = await db.Parties.FindAsync(input.PartyId);
        if (party is null || !party.Active || !user.CanSee(party.OwnerId)) return Error("Selecciona un destinatario activo.");

        quote.PartyId = input.PartyId;
        quote.ValidUntil = input.ValidUntil;
        quote.Terms = Clean(input.Terms);
        quote.Notes = Clean(input.Notes);
        quote.TaxRate = Round(input.TaxRate);
        quote.Revision = Guid.NewGuid();
        quote.Lines = input.Lines.Select((line, index) => new QuoteLine
        {
            Position = index + 1, Product = Clean(line.Product), Quantity = line.Quantity,
            Price = Round(line.Price), Discount = Round(line.Discount)
        }).ToList();
        if (quote.Lines.Any(x => x.Price <= 0)) return Error("Cada precio debe ser de al menos $0.01.");
        quote.Calculate();
        if (id is null) db.Quotes.Add(quote);
        await db.SaveChangesAsync();
        return Results.Ok(new { quote.Id });
    }

    private static async Task<IResult> QuoteStatus(int id, StatusInput input, ClaimsPrincipal user, CrmDb db)
    {
        var quote = await db.Quotes.FindAsync(id);
        if (quote is null || !user.CanSee(quote.OwnerId)) return Results.NotFound();
        var allowed = (quote.Status, input.Status) is ("Borrador", "Enviada") or
            ("Enviada", "Aceptada") or ("Enviada", "Rechazada");
        if (!allowed || quote.ValidUntil < Today()) return Conflict("El estado o la vigencia impiden este cambio.");
        quote.Status = input.Status;
        quote.Revision = Guid.NewGuid();
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
                sale.Id, sale.QuoteId, party = party.Name, owner = owner.Name, sale.Date, sale.Status,
                sale.CancelReason, sale.CancelledBy, sale.CancelledAt, quote.Subtotal, quote.Tax, quote.Total,
                lines = quote.Lines.OrderBy(x => x.Position).ToList()
            }).ToListAsync());
    }

    private static async Task<IResult> CreateSale(int id, ClaimsPrincipal user, CrmDb db)
    {
        var quote = await db.Quotes.FindAsync(id);
        if (quote is null || !user.CanSee(quote.OwnerId)) return Results.NotFound();
        if (quote.Status != "Aceptada") return Conflict("La cotización debe estar aceptada.");
        var party = await db.Parties.FindAsync(quote.PartyId);
        if (party is not { Active: true, Kind: "Cliente" })
            return Conflict("El destinatario debe ser un cliente activo. Convierte al prospecto desde su ficha.");
        if (await db.Sales.AnyAsync(x => x.QuoteId == id)) return Conflict("La cotización ya tiene una venta.");
        var sale = new Sale { QuoteId = id };
        db.Sales.Add(sale);
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
            sale.CancelReason = Clean(input.Reason);
            sale.CancelledBy = user.Identity!.Name!;
            sale.CancelledAt = DateTimeOffset.UtcNow;
        }
        else if ((sale.Status, input.Status) is not (("Registrada", "En proceso") or ("En proceso", "Completada")))
            return Conflict("La venta no admite ese cambio de estado.");

        sale.Status = input.Status;
        sale.Revision = Guid.NewGuid();
        await db.SaveChangesAsync();
        return Results.NoContent();
    }

    private sealed record QuoteInput(int PartyId, DateOnly ValidUntil, decimal TaxRate, LineInput[] Lines,
        string? Terms = null, string? Notes = null);
    private sealed record LineInput(string? Product, int Quantity, decimal Price, decimal Discount = 0);
    private sealed record StatusInput(string Status, string? Reason = null);
}
