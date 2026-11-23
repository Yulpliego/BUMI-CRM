using Microsoft.EntityFrameworkCore;
using static NexoCrm.CrmRules;

namespace NexoCrm;

internal static class ImprovementDemo
{
    public static async Task Load(CrmDb db)
    {
        // The original demo loader marks its records and makes this enrichment safe to replay.
        await using var transaction = await db.Database.BeginTransactionAsync();
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(54291370)");
        const string batch = "distribuidora-aurora-mejoras-v1";
        if (await db.Database.SqlQuery<int>($"""SELECT 1 AS "Value" FROM "DemoLoads" WHERE "Key" = {batch}""").AnyAsync()) return;

        var campaigns = await db.Campaigns.Include(x => x.Audience).Where(x => x.Name.StartsWith("Aurora · ") &&
            x.Description == "Campaña de muestra de Distribuidora Aurora." && x.Start <= Today())
            .OrderBy(x => x.Start).ThenBy(x => x.Id).ToListAsync();
        var attributed = (await db.CampaignOrigins.Select(x => x.PartyId).ToListAsync()).ToHashSet();
        foreach (var campaign in campaigns.Take(6))
        foreach (var party in campaign.Audience.Where(x => x.Email.Contains("@aurora-demo")).OrderBy(x => x.Id).Where(x => !attributed.Contains(x.Id)).Take(4))
        {
            db.CampaignOrigins.Add(new CampaignOrigin { CampaignId = campaign.Id, PartyId = party.Id, CapturedOn = campaign.Start,
                Source = campaign.Channel + " · muestra Aurora", Segment = party.Industry,
                Cost = 65 + party.Id % 15 * 4 + campaign.Id % 8 });
            attributed.Add(party.Id);
        }

        var links = await (from item in db.SupplierItems
            join p in db.Products on item.ProductId equals p.Id
            join supplier in db.Suppliers on item.SupplierId equals supplier.Id
            where p.Sku.StartsWith("AUR-") && supplier.Email.Contains("@aurora-proveedor")
            select new { item.SupplierId, item.ProductId, p.Price, p.Sku }).ToListAsync();
        var existing = (await db.SupplyTerms.ToListAsync()).ToDictionary(x => (x.SupplierId, x.ProductId));
        foreach (var link in links)
        {
            if (existing.ContainsKey((link.SupplierId, link.ProductId))) continue;
            var term = new SupplyTerm { SupplierId = link.SupplierId, ProductId = link.ProductId,
                Cost = Round(link.Price * .62m), LeadDays = 4 + link.SupplierId % 7 };
            existing.Add((term.SupplierId, term.ProductId), term);
            db.SupplyTerms.Add(term);
        }
        if (links.Select(x => x.SupplierId).Distinct().Count() >= 2)
        {
            foreach (var item in links.Where(x => x.Sku is "AUR-LUM" or "AUR-REG" or "AUR-ESC"))
            {
                var alternate = links.First(x => x.SupplierId != item.SupplierId);
                if (existing.ContainsKey((alternate.SupplierId, item.ProductId))) continue;
                if (!await db.SupplierItems.AnyAsync(x => x.SupplierId == alternate.SupplierId && x.ProductId == item.ProductId))
                    db.SupplierItems.Add(new SupplierItem { SupplierId = alternate.SupplierId, ProductId = item.ProductId });
                db.SupplyTerms.Add(new SupplyTerm { SupplierId = alternate.SupplierId, ProductId = item.ProductId,
                    Cost = Round(item.Price * .66m), LeadDays = 3 });
            }
        }

        var history = await db.Sales.Include(x => x.Document).Where(x => x.Status == "Completada" &&
                x.Document.Notes == "Distribuidora Aurora · datos de muestra")
            .OrderByDescending(x => x.Date).ThenByDescending(x => x.Id).Take(12).ToListAsync();
        var historyIds = history.Select(x => x.Id).ToArray();
        var used = (await db.Fulfillments.Where(x => historyIds.Contains(x.SaleId))
            .Select(x => x.SaleId).Distinct().ToListAsync()).ToHashSet();
        foreach (var (sale, index) in history.Select((sale, index) => (sale, index)))
        {
            if (used.Contains(sale.Id)) continue;
            foreach (var line in sale.Document.Lines)
                db.Fulfillments.Add(new Fulfillment { SaleId = sale.Id, Position = line.Position, Quantity = line.Quantity,
                    Kind = "Entrega", EffectiveOn = sale.Date, PromisedOn = sale.Date.AddDays(index % 4 == 0 ? -1 : 1),
                    Reason = "Entrega histórica de muestra Aurora", Actor = "Datos de muestra", RequestId = Guid.NewGuid() });
        }
        await db.SaveChangesAsync();
        await db.Database.ExecuteSqlInterpolatedAsync($"""INSERT INTO "DemoLoads" ("Key", "LoadedAt") VALUES ({batch}, NOW())""");
        await transaction.CommitAsync();
    }
}
