using Microsoft.EntityFrameworkCore;
using static NexoCrm.CrmRules;

namespace NexoCrm;

internal static class DemoDataset
{
    private const string Batch = "distribuidora-aurora-v1";

    public static async Task Load(CrmDb db, ILogger logger)
    {
        await using var transaction = await db.Database.BeginTransactionAsync();
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(54291369)");
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS "DemoLoads" ("Key" text PRIMARY KEY, "LoadedAt" timestamptz NOT NULL)
            """);
        if (await db.Database.SqlQuery<int>($"""SELECT 1 AS "Value" FROM "DemoLoads" WHERE "Key" = {Batch}""").AnyAsync())
        {
            await transaction.CommitAsync();
            logger.LogInformation("La muestra de Distribuidora Aurora ya está cargada.");
            return;
        }

        var accounts = await db.Accounts.Where(x => x.Active && Commercial.Contains(x.Role)).ToListAsync();
        var admin = accounts.FirstOrDefault(x => x.Email == "admin@nexo.test") ?? accounts.First(x => Managers.Contains(x.Role));
        var seller = accounts.FirstOrDefault(x => x.Email == "ventas@nexo.test") ?? admin;
        var manager = accounts.FirstOrDefault(x => x.Email == "gerencia@nexo.test") ?? admin;
        var marketer = await db.Accounts.FirstOrDefaultAsync(x => x.Active && x.Email == "marketing@nexo.test") ?? admin;
        Account[] owners = [seller, seller, admin, manager];
        var today = Today();
        var first = new DateOnly(today.Year, today.Month, 1).AddMonths(-12);
        var random = new Random(8127);

        (string Sku, string Name, string Category, decimal Price, string Unit)[] catalog =
        [
            ("MON", "Monitor IPS 24 pulgadas", "Cómputo", 2840, "Pieza"),
            ("DOC", "Base USB-C multipuerto", "Cómputo", 1490, "Pieza"),
            ("TEC", "Teclado inalámbrico compacto", "Accesorios", 645, "Pieza"),
            ("AUD", "Diadema USB con micrófono", "Accesorios", 1090, "Pieza"),
            ("TON", "Tóner láser negro alto rendimiento", "Consumibles", 825, "Pieza"),
            ("CAR", "Cartucho de tinta tricolor", "Consumibles", 540, "Pieza"),
            ("PAP", "Papel carta 75 g", "Papelería", 124, "Paquete"),
            ("LIB", "Libreta ejecutiva rayada", "Papelería", 102, "Pieza"),
            ("SIL", "Silla ergonómica de malla", "Mobiliario", 3760, "Pieza"),
            ("ESC", "Escritorio modular 120 cm", "Mobiliario", 4180, "Pieza"),
            ("LUM", "Lámpara LED de escritorio", "Mobiliario", 870, "Pieza"),
            ("REG", "Regulador de voltaje 1200 VA", "Cómputo", 1560, "Pieza")
        ];
        var products = catalog.Select(x => new Product { Sku = "AUR-" + x.Sku, Name = x.Name, Category = x.Category,
            Price = x.Price, Unit = x.Unit, Minimum = 20, Stock = 1200,
            Description = "Catálogo mayorista de Distribuidora Aurora · datos de muestra" }).ToArray();
        string[] suppliersNames = ["Horizonte Tecnología", "Papelera Cedro", "Mobiliario Abedul", "Consumibles Senda", "Enlace Periféricos"];
        string[] contacts = ["Mariana Soto", "Carlos Vélez", "Lucía Lara", "Andrés Luna", "Sara Campos", "Iván Solís"];
        string[] cities = ["Puebla", "Tlaxcala", "Querétaro", "Toluca", "Ciudad de México"];
        var suppliers = suppliersNames.Select((name, i) => new Supplier { Name = name, Contact = contacts[i],
            Email = $"pedidos@aurora-proveedor{i+1}.test", Address = cities[i] + ", México" }).ToArray();
        string[] names = ["Estudio Calandria", "Laboratorios Alisio", "Red Clínica Jacaranda", "Grupo Faro Logístico",
            "Instituto Puerta Azul", "Consultora Níspero", "Taller Magnolio", "Oficinas Mirador", "Agencia Nube Baja",
            "Editorial Umbral", "Colegio Sierra Clara", "Servicios Litoral", "Constructora Arrayán", "Despacho Robledal",
            "Clínicas Arroyo", "Almacenes Bruma", "Red Educativa Senda", "Estudio Lienzo", "Grupo Encino",
            "Operadora Vía Clara", "Campus La Rivera", "Hotel Sendero", "Estudio Fulgor", "Servicios Vértice"];
        string[] industries = ["Arquitectura", "Salud", "Educación", "Logística", "Servicios profesionales"];
        string[] sources = ["Referido", "Evento", "Formulario", "Redes sociales"];
        var parties = names.Select((name, i) => new Party {
            Name = name, Kind = i < 16 ? "Cliente" : "Prospecto", Contact = contacts[i % contacts.Length],
            OwnerId = owners[i % owners.Length].Id, Industry = industries[i % industries.Length],
            Address = cities[i % cities.Length] + ", México", Email = $"compras@aurora-demo{i+1}.test",
            Source = sources[i % sources.Length], Stage = i % 3 == 0 ? "En seguimiento" : "Calificado"
        }).ToArray();
        db.AddRange(products);
        db.AddRange(suppliers);
        db.AddRange(parties);
        await db.SaveChangesAsync();

        int[] supplierByProduct = [0, 0, 4, 4, 3, 3, 1, 1, 2, 2, 2, 0];
        db.SupplierItems.AddRange(products.Select((p, i) => new SupplierItem { ProductId = p.Id, SupplierId = suppliers[supplierByProduct[i]].Id }));
        foreach (var p in products) Movement(p, "Entrada", p.Stock, "Saldo inicial del catálogo Aurora", first.AddDays(-1), admin);

        for (var i = 0; i < parties.Length; i++)
        {
            var party = parties[i];
            var owner = owners[i % owners.Length];
            db.Contacts.Add(new Contact { PartyId = party.Id, Name = party.Contact, Email = party.Email, Position = "Compras y administración" });
            db.HistoryEntries.Add(new HistoryEntry { PartyId = party.Id, Type = "Llamada", Actor = owner.Name,
                At = On(today.AddDays(-i - 2)), Description = "Confirmó el volumen de compra y solicitó opciones de entrega." });
            var opportunity = new Opportunity { PartyId = party.Id, OwnerId = owner.Id, Value = 9500 + i * 1725,
                Description = i % 2 == 0 ? "Renovación de estaciones de trabajo" : "Suministro trimestral de consumibles",
                Interest = i % 2 == 0 ? "Cómputo y mobiliario" : "Consumibles y papelería",
                Stage = OpportunityStages[i % OpportunityStages.Length], UpdatedAt = On(today.AddDays(-i % 14)),
                ExpectedClose = today.AddDays(i % OpportunityStages.Length >= 4 ? -i : i + 3) };
            db.Opportunities.Add(opportunity);
        }
        await db.SaveChangesAsync();
        var partyIds = parties.Select(p => p.Id).ToArray();
        var opportunities = await db.Opportunities.Where(x => partyIds.Contains(x.PartyId)).ToDictionaryAsync(x => x.PartyId);

        Quote?[] followUps = new Quote?[parties.Length];
        int[] salesVolume = [4, 5, 5, 6, 5, 7, 6, 7, 8, 8, 9, 10, 4];
        for (var m = 0; m < salesVolume.Length; m++)
        {
            var month = first.AddMonths(m);
            var date = (int day) => month.AddDays(Math.Min(day, m == 12 ? today.Day - 1 : day));
            var count = salesVolume[m];
            for (var i = 0; i < count + 3; i++)
            {
                var partyIndex = i < count ? (m * 3 + i) % 16 : 16 + (m + i) % 8;
                var party = parties[partyIndex];
                var owner = owners[partyIndex % owners.Length];
                var quoteDate = date(1 + i * 2);
                var quote = new Quote { PartyId = party.Id, OwnerId = owner.Id, Date = quoteDate,
                    ValidUntil = quoteDate.AddDays(21), Status = i < count ? "Aceptada" : i == count ? "Enviada" :
                        i == count + 1 ? "Borrador" : "Rechazada",
                    Terms = "Pago por transferencia. Entrega de 3 a 5 días hábiles.",
                    Notes = "Distribuidora Aurora · datos de muestra", Lines = [] };
                var productIndex = (m + i * 3) % products.Length;
                for (var position = 0; position < 2 + i % 2; position++)
                {
                    var product = products[(productIndex + position * 5) % products.Length];
                    quote.Lines.Add(new QuoteLine { Position = position + 1, ProductId = product.Id, Product = product.Name,
                        Price = product.Price, Quantity = random.Next(2, 10) + m / 4, Discount = position == 0 && i % 4 == 0 ? 5 : 0 });
                }
                quote.Calculate();
                db.Quotes.Add(quote);
                if (i >= count)
                {
                    if (quote.Status == "Enviada") followUps[partyIndex] = quote;
                    continue;
                }
                var saleDate = date(2 + i * 2);
                var cancelled = i == 0 && m is 2 or 7 or 10;
                var sale = new Sale { Document = quote, Date = saleDate, Status = cancelled ? "Cancelada" :
                    m < 12 ? "Completada" : i % 2 == 0 ? "En proceso" : "Registrada" };
                if (cancelled)
                {
                    sale.CancelledAt = On(saleDate).AddHours(2);
                    sale.CancelledBy = owner.Name;
                    sale.CancelReason = "El cliente reprogramó la compra.";
                }
                db.Sales.Add(sale);
                db.SaleEvents.Add(new SaleEvent { Sale = sale, Actor = owner.Name, At = On(saleDate),
                    Status = "Registrada", Description = "Venta generada desde cotización aceptada." });
                if (sale.Status != "Registrada")
                    db.SaleEvents.Add(new SaleEvent { Sale = sale, Actor = owner.Name, At = On(saleDate).AddHours(2),
                        Status = sale.Status, Description = cancelled ? sale.CancelReason : "Estado actualizado por el equipo comercial." });
                foreach (var line in quote.Lines)
                {
                    var product = products.Single(p => p.Id == line.ProductId);
                    product.Stock -= line.Quantity;
                    Movement(product, "Venta", -line.Quantity, "Salida por venta de Aurora", saleDate, owner, sale);
                    if (!cancelled) continue;
                    product.Stock += line.Quantity;
                    Movement(product, "Devolución", line.Quantity, "Devolución por cancelación", saleDate, owner, sale, 2);
                }
            }
            if (m >= 8)
            {
                string[] channels = ["Email", "Eventos", "Redes sociales"];
                string[] themes = ["Abastecimiento de oficina", "Muestra de mobiliario", "Equipos para trabajo híbrido"];
                for (var i = 0; i < channels.Length; i++)
                {
                    var reached = 220 + (m - 8) * 55 + i * 96;
                    var planned = m == 12 && i == 2;
                    db.Campaigns.Add(new Campaign { Name = $"Aurora · {themes[i]} · {month:yyyy-MM}", Channel = channels[i],
                        Goal = "Generar solicitudes de cotización", Segment = industries[(m + i) % industries.Length],
                        Description = "Campaña de muestra de Distribuidora Aurora.",
                        Start = planned ? today.AddDays(7) : date(0),
                        End = m == 12 ? today.AddDays(planned ? 21 : 8) : month.AddDays(22),
                        Status = planned ? "Planeada" : m == 12 ? "Activa" : "Finalizada",
                        Reached = planned ? 0 : reached, Leads = planned ? 0 : reached * (12 - i * 3 + m % 4) / 100,
                        OwnerId = marketer.Id, Audience = parties.Where((_, index) => (index + m) % 3 == i).ToList() });
                }
            }
        }
        await db.SaveChangesAsync();

        for (var i = 0; i < 12; i++)
        {
            var party = parties[12 + i];
            var quote = followUps[i + 12];
            db.AgendaItems.Add(new AgendaItem { PartyId = party.Id, OwnerId = party.OwnerId,
                OpportunityId = opportunities[party.Id].Id, QuoteId = quote?.Id,
                Title = i % 2 == 0 ? $"Revisar propuesta con {party.Name}" : $"Agendar llamada con {party.Name}",
                Description = "Seguimiento comercial de la cartera de muestra.",
                Type = i % 2 == 0 ? "Seguimiento" : "Llamada", Status = "Pendiente",
                Due = On(today.AddDays(i - 3)) });
        }
        foreach (var p in products.TakeLast(3))
        {
            var target = p.Minimum - (products.Length - Array.IndexOf(products, p)) * 4;
            var delta = target - p.Stock;
            p.Stock = target;
            Movement(p, "Ajuste", delta, "Conciliación de existencias en conteo de almacén", today, admin, hours: 3);
        }
        await db.SaveChangesAsync();
        await db.Database.ExecuteSqlInterpolatedAsync($"""INSERT INTO "DemoLoads" ("Key", "LoadedAt") VALUES ({Batch}, NOW())""");
        await transaction.CommitAsync();
        logger.LogInformation("Se cargó la muestra de Distribuidora Aurora en PostgreSQL.");

        void Movement(Product product, string type, int delta, string reason, DateOnly date, Account owner,
            Sale? sale = null, int hours = 0) =>
            db.StockEntries.Add(new StockEntry { ProductId = product.Id, Sale = sale, Type = type, Delta = delta,
                Balance = product.Stock, Reason = reason, Actor = owner.Name, At = On(date).AddHours(hours) });
    }

    private static DateTimeOffset On(DateOnly date) => new(date.ToDateTime(new TimeOnly(14, 0)), TimeSpan.Zero);
}
