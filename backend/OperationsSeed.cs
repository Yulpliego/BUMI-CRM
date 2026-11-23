using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace NexoCrm;

public static class OperationsSeed
{
    public static async Task Initialize(CrmDb db, IPasswordHasher<Account> hasher, IConfiguration config)
    {
        if (config["DemoPassword"] is not { Length: >= 12 and <= 128 } password) return;
        var admin = await db.Accounts.SingleOrDefaultAsync(x => x.Email == "admin@nexo.test");
        if (admin is null) return;
        var seller = await db.Accounts.SingleOrDefaultAsync(x => x.Email == "ventas@nexo.test");
        var protectedRoles = new[] { ("inventario@nexo.test", "Camila Ríos", "Inventario"), ("compras@nexo.test", "Mateo León", "Compras") };
        await using var transaction = await db.Database.BeginTransactionAsync();
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(54291368)");
        foreach (var (email, name, role) in protectedRoles)
        {
            if (await db.Accounts.AnyAsync(x => x.Email == email)) continue;
            var account = new Account { Name = name, Email = email, Role = role };
            account.PasswordHash = hasher.HashPassword(account, password);
            db.Accounts.Add(account);
        }

        if (!await db.Products.AnyAsync() && !await db.Suppliers.AnyAsync() && !await db.AgendaItems.AnyAsync())
        {
            Product[] catalog =
            [
                new() { Sku = "PAP-A4", Name = "Papel multipropósito A4", Category = "Papelería", Unit = "Paquete", Price = 145, Stock = 76, Minimum = 20 },
                new() { Sku = "MON-24", Name = "Monitor empresarial 24 pulgadas", Category = "Cómputo", Price = 2950, Stock = 12, Minimum = 4 },
                new() { Sku = "TON-85", Name = "Tóner negro 85A", Category = "Consumibles", Price = 720, Stock = 3, Minimum = 8 },
                new() { Sku = "TEC-USB", Name = "Teclado USB", Category = "Accesorios", Price = 380, Stock = 19, Minimum = 5 }
            ];
            db.Products.AddRange(catalog);
            var supplier = new Supplier { Name = "Suministros Delta", Contact = "Andrea Ruiz", Email = "pedidos@delta.test" };
            db.Suppliers.Add(supplier);
            await db.SaveChangesAsync();
            db.SupplierItems.AddRange(catalog.Where(x => x.Category is "Papelería" or "Consumibles")
                .Select(x => new SupplierItem { SupplierId = supplier.Id, ProductId = x.Id }));
            db.StockEntries.AddRange(catalog.Select(x => new StockEntry { ProductId = x.Id,
                Type = "Entrada", Reason = "Inventario inicial de demostración.", Actor = admin.Name, Delta = x.Stock, Balance = x.Stock }));
            var lead = await db.Parties.FirstOrDefaultAsync(x => x.Name == "Oficinas Nova" && x.OwnerId == admin.Id);
            var now = DateTimeOffset.UtcNow;
            db.AgendaItems.AddRange(
                new AgendaItem { Title = "Confirmar renovación de equipo", Type = "Llamada", Due = now.AddHours(4),
                    OwnerId = admin.Id, PartyId = lead?.Id, Description = "Revisar las necesidades de las estaciones de trabajo." },
                new AgendaItem { Title = "Revisar propuestas del equipo", Type = "Tarea", Due = now.AddDays(1), OwnerId = admin.Id });
            if (seller is not null)
                db.AgendaItems.Add(new AgendaItem { Title = "Confirmar recepción de cotización", Type = "Seguimiento",
                    Due = now.AddHours(6), OwnerId = seller.Id });
            if (lead is not null)
                db.HistoryEntries.Add(new HistoryEntry { PartyId = lead.Id, Type = "Llamada",
                    Description = "El prospecto solicitó opciones para renovar estaciones de trabajo.", Actor = admin.Name, At = now.AddHours(-4) });
        }
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
    }
}
