using System.Globalization;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;

namespace NexoCrm;

internal static class WorkspaceSearch
{
    public static async Task<IResult> Find(string? q, ClaimsPrincipal user, CrmDb db, CancellationToken cancel)
    {
        var term = (q ?? "").Trim().ToLowerInvariant();
        if (term.Length < 2) return Results.Ok(Array.Empty<Hit>());
        if (term.Length > 80) return CrmRules.Error("La búsqueda admite hasta 80 caracteres.");

        var enabled = await WorkEndpoints.Enabled(user, db);
        var owner = user.UserId();
        var manager = user.IsManager();
        var matches = new List<Hit>();
        const int limit = 4;
        var parties = db.Parties.AsNoTracking().Where(x => manager || x.OwnerId == owner);
        var documents = db.Quotes.AsNoTracking().Where(x => manager || x.OwnerId == owner);

        if (enabled.Contains("clientes"))
        {
            matches.AddRange(await parties.Where(x => x.Name.ToLower().Contains(term) || x.Email.ToLower().Contains(term) ||
                    x.Contact.ToLower().Contains(term))
                .OrderBy(x => x.Name).ThenBy(x => x.Id).Take(limit)
                .Select(x => new Hit("clientes", x.Id, x.Name, x.Kind)).ToListAsync(cancel));
            matches.AddRange(await (from item in db.Opportunities
                join party in parties on item.PartyId equals party.Id
                where party.Active && (manager || item.OwnerId == owner) &&
                    (item.Description.ToLower().Contains(term) || party.Name.ToLower().Contains(term))
                orderby item.UpdatedAt descending, item.Id
                select new Hit("oportunidades", item.Id, item.Description, party.Name)).Take(limit).ToListAsync(cancel));
        }

        if (enabled.Contains("cotizaciones"))
        {
            var id = FolioId(term, "cot");
            var rows = await (from item in documents
                join party in db.Parties on item.PartyId equals party.Id
                where !item.IsDirectSale && (item.Id == id || party.Name.ToLower().Contains(term))
                orderby (item.Id == id) descending, item.Date descending, item.Id descending
                select new { item.Id, party.Name, item.Status }).Take(limit).ToListAsync(cancel);
            matches.AddRange(rows.Select(x => new Hit("cotizaciones", x.Id, $"COT-{x.Id:D4} · {x.Name}", x.Status)));
        }

        if (enabled.Contains("ventas"))
        {
            var id = FolioId(term, "vta");
            var rows = await (from item in db.Sales
                join document in documents on item.QuoteId equals document.Id
                join party in db.Parties on document.PartyId equals party.Id
                where item.Id == id || party.Name.ToLower().Contains(term)
                orderby (item.Id == id) descending, item.Date descending, item.Id descending
                select new { item.Id, party.Name, item.Status }).Take(limit).ToListAsync(cancel);
            matches.AddRange(rows.Select(x => new Hit("ventas", x.Id, $"VTA-{x.Id:D4} · {x.Name}", x.Status)));
        }

        if (enabled.Contains("marketing"))
            matches.AddRange(await db.Campaigns.Where(x => x.Name.ToLower().Contains(term))
                .OrderBy(x => x.Name).ThenBy(x => x.Id).Take(limit)
                .Select(x => new Hit("marketing", x.Id, x.Name, x.Status)).ToListAsync(cancel));

        if (enabled.Contains("inventario"))
            matches.AddRange(await db.Products.Where(x => x.Name.ToLower().Contains(term) || x.Sku.ToLower().Contains(term))
                .OrderBy(x => x.Name).ThenBy(x => x.Id).Take(limit)
                .Select(x => new Hit("inventario", x.Id, x.Name, x.Sku)).ToListAsync(cancel));

        if (enabled.Contains("proveedores"))
            matches.AddRange(await db.Suppliers.Where(x => x.Name.ToLower().Contains(term) || x.Rfc.ToLower().Contains(term))
                .OrderBy(x => x.Name).ThenBy(x => x.Id).Take(limit)
                .Select(x => new Hit("proveedores", x.Id, x.Name, x.Rfc)).ToListAsync(cancel));

        if (enabled.Contains("agenda"))
            matches.AddRange(await db.AgendaItems.Where(x => (manager || x.OwnerId == owner) && x.Title.ToLower().Contains(term))
                .OrderBy(x => x.Due).ThenBy(x => x.Id).Take(limit)
                .Select(x => new Hit("agenda", x.Id, x.Title, x.Status)).ToListAsync(cancel));

        return Results.Ok(matches);
    }

    private static int FolioId(string term, string prefix)
    {
        var value = term.StartsWith(prefix + "-", StringComparison.Ordinal) ? term[(prefix.Length + 1)..] : term;
        return int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var id) ? id : 0;
    }

    private sealed record Hit(string Module, int Id, string Title, string Detail);
}

