using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace NexoCrm;

public static class Seed
{
    public static async Task Initialize(CrmDb db, IPasswordHasher<Account> hasher, IConfiguration config)
    {
        var existing = await db.Modules.Select(x => x.Key).ToListAsync();
        db.Modules.AddRange(CrmRules.Modules.Keys.Except(existing).Select(x => new ModuleSetting { Key = x }));
        await db.SaveChangesAsync();

        if (await db.Accounts.AnyAsync()) return;
        var password = config["DemoPassword"];
        if (password is not { Length: >= 12 and <= 128 })
            throw new InvalidOperationException("Define DemoPassword con 12 a 128 caracteres para crear las cuentas iniciales.");

        await using var transaction = await db.Database.BeginTransactionAsync();
        Account Make(string name, string email, string role)
        {
            var account = new Account { Name = name, Email = email + "@nexo.test", Role = role };
            account.PasswordHash = hasher.HashPassword(account, password);
            return account;
        }

        var admin = Make("Alex García", "admin", "Administrador");
        var manager = Make("Daniela Torres", "gerencia", "Gerente");
        var seller = Make("Luis Morales", "ventas", "Vendedor");
        var marketer = Make("Sofía Reyes", "marketing", "Marketing");
        db.Accounts.AddRange(admin, manager, seller, marketer);
        await db.SaveChangesAsync();

        var clients = new[]
        {
            new Party { Name = "Estudio Norte", Kind = "Cliente", Contact = "Paola Núñez", Email = "compras@estudionorte.test", Industry = "Arquitectura", OwnerId = seller.Id },
            new Party { Name = "Grupo Meridian", Kind = "Cliente", Contact = "Bruno Silva", Email = "oficina@meridian.test", Industry = "Servicios", OwnerId = seller.Id },
            new Party { Name = "Consultora Álamo", Kind = "Cliente", Contact = "Elena Vega", Email = "contacto@alamo.test", Industry = "Consultoría", OwnerId = admin.Id }
        };
        var leads = new[]
        {
            new Party { Name = "Instituto Horizonte", Contact = "Ana Paredes", Email = "compras@horizonte.test", Stage = "Calificado", Source = "Evento", OwnerId = seller.Id },
            new Party { Name = "Taller Colectivo", Contact = "Rafael Cruz", Stage = "En seguimiento", Source = "Referido", OwnerId = seller.Id },
            new Party { Name = "Oficinas Nova", Contact = "Lucía Flores", Source = "Formulario", OwnerId = admin.Id }
        };
        db.Parties.AddRange(clients.Concat(leads));
        await db.SaveChangesAsync();
        var today = CrmRules.Today();
        db.Contacts.Add(new Contact { PartyId = clients[0].Id, Name = "Paola Núñez", Position = "Compras", Email = clients[0].Email });
        db.Opportunities.AddRange(
            new Opportunity { PartyId = leads[0].Id, Description = "Renovación del equipo administrativo", Interest = "Monitores y periféricos", Value = 36000, Stage = "Propuesta", OwnerId = seller.Id, ExpectedClose = today.AddDays(15) },
            new Opportunity { PartyId = leads[1].Id, Description = "Insumos para nuevas oficinas", Interest = "Papelería y consumibles", Value = 18500, Stage = "En seguimiento", OwnerId = seller.Id, ExpectedClose = today.AddDays(25) },
            new Opportunity { PartyId = leads[2].Id, Description = "Compra de estaciones de trabajo", Value = 48500, Stage = "Nueva", OwnerId = admin.Id });
        db.Campaigns.AddRange(
            new Campaign { Name = "Renovación de oficina", Goal = "Generar solicitudes de cotización", Channel = "Email", Segment = "Oficinas de 10 a 50 personas", Status = "Activa", Start = today.AddDays(-8), End = today.AddDays(20), Reached = 38, Leads = 9, OwnerId = marketer.Id, Audience = [clients[0], leads[0], leads[2]] },
            new Campaign { Name = "Encuentro de proveedores", Goal = "Conocer nuevos prospectos", Channel = "Eventos", Segment = "PYMES de servicios", Status = "Finalizada", Start = today.AddDays(-38), End = today.AddDays(-20), Reached = 24, Leads = 6, OwnerId = marketer.Id, Audience = [leads[0], leads[1]] });

        Quote MakeQuote(Party party, DateOnly date, string status, string product, int quantity, decimal price)
        {
            var quote = new Quote { PartyId = party.Id, OwnerId = party.OwnerId, Date = date, ValidUntil = today.AddDays(21),
                Status = status, Terms = "Pago por transferencia. Precios en MXN.",
                Lines = [new QuoteLine { Position = 1, Product = product, Quantity = quantity, Price = price }] };
            quote.Calculate();
            db.Quotes.Add(quote);
            return quote;
        }

        var history = Enumerable.Range(0, 6).Select(i =>
        {
            var date = today.AddMonths(-i);
            return MakeQuote(clients[i % clients.Length], date, "Aceptada", i % 2 == 0 ? "Monitor de 24 pulgadas" : "Kit de papelería",
                new[] { 14, 10, 18, 8, 12, 7 }[i], i % 2 == 0 ? 2450 : 980);
        }).ToList();
        MakeQuote(leads[0], today, "Borrador", "Teclado inalámbrico", 12, 480);
        MakeQuote(clients[1], today, "Aceptada", "Silla de oficina", 6, 2580);
        MakeQuote(clients[2], today, "Enviada", "Caja de papel carta", 10, 690);
        await db.SaveChangesAsync();
        db.Sales.AddRange(history.Select((quote, i) => new Sale { QuoteId = quote.Id, Date = quote.Date, Status = i == 0 ? "En proceso" : "Completada" }));
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
    }
}
