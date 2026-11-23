using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using static NexoCrm.CrmRules;

namespace NexoCrm;

public static class StockEndpoints
{
    public static void Map(WebApplication app)
    {
        var inventory = app.Module("inventario");
        inventory.MapGet("", async (CrmDb db) => Results.Ok(await db.Products.AsNoTracking().OrderBy(x => x.Name).ToListAsync()));
        inventory.MapGet("/{id:int}/movimientos", async (int id, CrmDb db) => Results.Ok(await db.StockEntries
            .Where(x => x.ProductId == id).OrderByDescending(x => x.Id).Take(150)
            .Select(x => new { x.Id, x.At, x.Type, x.Reason, x.Delta, x.Balance, x.Actor, x.SaleId }).ToListAsync()));
        inventory.MapPost("", (ProductInput input, CrmDb db) => SaveProduct(null, input, db))
            .RequireAuthorization(policy => policy.RequireRole(StockEditors));
        inventory.MapPut("/{id:int}", (int id, ProductInput input, CrmDb db) => SaveProduct(id, input, db))
            .RequireAuthorization(policy => policy.RequireRole(StockEditors));
        inventory.MapPost("/{id:int}/movimientos", Move).RequireAuthorization(policy => policy.RequireRole(StockEditors));

        var suppliers = app.Module("proveedores");
        suppliers.MapGet("", ListSuppliers);
        suppliers.MapGet("/productos", Catalog);
        suppliers.MapPost("", (SupplierInput input, CrmDb db) => SaveSupplier(null, input, db))
            .RequireAuthorization(policy => policy.RequireRole(SuppliersEditors));
        suppliers.MapPut("/{id:int}", (int id, SupplierInput input, CrmDb db) => SaveSupplier(id, input, db))
            .RequireAuthorization(policy => policy.RequireRole(SuppliersEditors));
    }

    public static async Task<IResult> Catalog(CrmDb db) => Results.Ok(await db.Products.AsNoTracking()
        .Where(x => x.Active).OrderBy(x => x.Name).Select(x => new { x.Id, x.Sku, x.Name, x.Price, x.Stock, x.Unit }).ToListAsync());

    private static async Task<IResult> SaveProduct(int? id, ProductInput input, CrmDb db)
    {
        if (!Text(input.Sku, 40, true) || !Text(input.Name, 120, true) || !Text(input.Description, 500) ||
            !Text(input.Category, 80, true) || !Text(input.Unit, 30, true) || input.Price is < 0.01m or > 1_000_000 ||
            input.Minimum is < 0 or > 1_000_000)
            return Error("Revisa código, nombre, categoría, unidad, precio y mínimo.");
        var item = id.HasValue ? await db.Products.FindAsync(id.Value) : new Product();
        if (item is null) return Results.NotFound();
        item.Sku = Clean(input.Sku).ToUpperInvariant();
        item.Name = Clean(input.Name);
        item.Description = Clean(input.Description);
        item.Category = Clean(input.Category);
        item.Unit = Clean(input.Unit);
        item.Price = Round(input.Price);
        item.Minimum = input.Minimum;
        item.Active = input.Active;
        item.Revision = Guid.NewGuid();
        if (!id.HasValue) db.Products.Add(item);
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException error) when (error.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return Conflict("Ya existe un producto con ese código.");
        }
        return Results.Ok(item);
    }

    private static async Task<IResult> Move(int id, StockInput input, ClaimsPrincipal user, CrmDb db)
    {
        if (input.Type is not ("Entrada" or "Salida" or "Ajuste") || input.Quantity is < 0 or > 1_000_000 ||
            (input.Type != "Ajuste" && input.Quantity == 0) || !Text(input.Reason, 300, true))
            return Error("Indica un tipo, una cantidad válida y el motivo del movimiento.");
        var product = await db.Products.FindAsync(id);
        if (product is null) return Results.NotFound();
        if (!product.Active) return Conflict("Reactiva el producto para registrar un movimiento.");
        var delta = input.Type switch
        {
            "Entrada" => input.Quantity,
            "Salida" => -input.Quantity,
            _ => input.Quantity - product.Stock
        };
        if (delta == 0) return Error("El ajuste debe cambiar las existencias.");
        if (product.Stock + (long)delta is < 0 or > int.MaxValue)
            return Conflict("El movimiento supera las existencias disponibles o el límite permitido.");
        AddMovement(db, product, delta, input.Type, Clean(input.Reason), user);
        await db.SaveChangesAsync();
        return Results.Ok(product);
    }

    public static async Task<string?> ApplySale(CrmDb db, Sale sale, Quote document, ClaimsPrincipal user)
    {
        var quantities = document.Lines.Where(x => x.ProductId.HasValue)
            .GroupBy(x => x.ProductId!.Value).ToDictionary(x => x.Key, x => x.Sum(row => row.Quantity));
        if (quantities.Count == 0) return null;
        var ids = quantities.Keys.ToArray();
        var products = await db.Products.Where(x => ids.Contains(x.Id)).ToListAsync();
        if (products.Count != quantities.Count || products.Any(x => !x.Active)) return "Una partida usa un producto fuera del catálogo activo.";
        var shortfall = products.FirstOrDefault(x => x.Stock < quantities[x.Id]);
        if (shortfall is not null)
            return $"Existencias insuficientes de {shortfall.Name}. Disponibles: {shortfall.Stock}.";
        foreach (var product in products)
            AddMovement(db, product, -quantities[product.Id], "Venta", "Salida por venta registrada.", user, sale);
        return null;
    }

    public static async Task<bool> RestoreSale(CrmDb db, Sale sale, ClaimsPrincipal user)
    {
        var amounts = await db.StockEntries.Where(x => x.SaleId == sale.Id && (x.Type == "Venta" || x.Type == "Devolución"))
            .GroupBy(x => x.ProductId).Select(group => new { ProductId = group.Key, Amount = -group.Sum(x => x.Delta) })
            .Where(x => x.Amount > 0).ToDictionaryAsync(x => x.ProductId, x => x.Amount);
        if (amounts.Count == 0) return true;
        var ids = amounts.Keys.ToArray();
        var products = await db.Products.Where(x => ids.Contains(x.Id)).ToListAsync();
        if (products.Any(x => x.Stock + (long)amounts[x.Id] > int.MaxValue)) return false;
        foreach (var product in products)
            AddMovement(db, product, amounts[product.Id], "Devolución", "Reposición por cancelación de venta.", user, sale);
        return true;
    }

    internal static void AddMovement(CrmDb db, Product product, int delta, string type, string reason,
        ClaimsPrincipal user, Sale? sale = null)
    {
        product.Stock += delta;
        product.Revision = Guid.NewGuid();
        db.StockEntries.Add(new StockEntry { ProductId = product.Id, Sale = sale, Delta = delta, Balance = product.Stock,
            Type = type, Reason = reason, Actor = user.Identity!.Name! });
    }

    private static async Task<IResult> ListSuppliers(CrmDb db)
    {
        var suppliers = await db.Suppliers.AsNoTracking().OrderBy(x => x.Name).ToListAsync();
        var items = await (from link in db.SupplierItems
            join product in db.Products on link.ProductId equals product.Id
            orderby product.Name
            select new { link.SupplierId, product.Id, product.Sku, product.Name, product.Active }).ToListAsync();
        var related = items.ToLookup(x => x.SupplierId);
        return Results.Ok(suppliers.Select(x => new
        {
            x.Id, x.Name, x.Rfc, x.Contact, x.Phone, x.Email, x.Address, x.Active,
            products = related[x.Id].Select(p => new { p.Id, p.Sku, p.Name, p.Active })
        }));
    }

    private static async Task<IResult> SaveSupplier(int? id, SupplierInput input, CrmDb db)
    {
        if (!Text(input.Name, 140, true) || !Text(input.Rfc, 13) || !Text(input.Contact, 100) ||
            !Text(input.Phone, 40) || !Email(input.Email) || !Text(input.Address, 350) ||
            input.ProductIds is { Length: > 500 })
            return Error("Revisa los datos del proveedor y los productos seleccionados.");
        var item = id.HasValue ? await db.Suppliers.FindAsync(id.Value) : new Supplier();
        if (item is null) return Results.NotFound();
        var links = id.HasValue ? await db.SupplierItems.Where(x => x.SupplierId == item.Id).ToListAsync() : [];
        var wanted = input.ProductIds?.Distinct().ToArray();
        if (wanted is not null)
        {
            var previous = links.Select(x => x.ProductId);
            var additions = wanted.Except(previous).ToArray();
            if (await db.Products.CountAsync(x => additions.Contains(x.Id) && x.Active) != additions.Length)
                return Error("Selecciona productos activos del catálogo.");
            db.SupplierItems.RemoveRange(links.Where(x => !wanted.Contains(x.ProductId)));
        }

        item.Name = Clean(input.Name);
        item.Rfc = Clean(input.Rfc).ToUpperInvariant();
        item.Contact = Clean(input.Contact);
        item.Phone = Clean(input.Phone);
        item.Email = Clean(input.Email);
        item.Address = Clean(input.Address);
        item.Active = input.Active;
        item.Revision = Guid.NewGuid();
        await using var transaction = await db.Database.BeginTransactionAsync();
        if (!id.HasValue)
        {
            db.Suppliers.Add(item);
            await db.SaveChangesAsync();
        }
        if (wanted is not null)
            db.SupplierItems.AddRange(wanted.Except(links.Select(x => x.ProductId))
                .Select(productId => new SupplierItem { SupplierId = item.Id, ProductId = productId }));
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return Results.Ok(new { item.Id });
    }

    private sealed record ProductInput(string? Sku, string? Name, string? Category, string? Unit,
        decimal Price, int Minimum, bool Active, string? Description = null);
    private sealed record StockInput(string? Type, int Quantity, string? Reason);
    private sealed record SupplierInput(string? Name, bool Active, string? Rfc = null, string? Contact = null,
        string? Phone = null, string? Email = null, string? Address = null, int[]? ProductIds = null);
}
