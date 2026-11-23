using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using static NexoCrm.CrmRules;

namespace NexoCrm;

public static class MarketingEndpoints
{
    public static void Map(WebApplication app)
    {
        var routes = app.Module("marketing");
        routes.MapGet("", List);
        routes.MapGet("/publico", async (CrmDb db) => Results.Ok(await db.Parties.AsNoTracking()
            .Where(x => x.Active).OrderBy(x => x.Name).Select(x => new { x.Id, x.Name, x.Kind }).ToListAsync()));
        routes.MapPost("/asistente", CampaignAssistant.Suggest);
        var writers = new[] { "Administrador", "Marketing" };
        routes.MapPost("", (CampaignInput input, ClaimsPrincipal user, CrmDb db) => Save(null, input, user, db));
        routes.MapPut("/{id:int}", (int id, CampaignInput input, ClaimsPrincipal user, CrmDb db) => Save(id, input, user, db))
            .RequireAuthorization(policy => policy.RequireRole(writers));
    }

    private static async Task<IResult> List(CrmDb db) => Results.Ok(await (
        from campaign in db.Campaigns.AsNoTracking().AsSplitQuery()
        join owner in db.Accounts on campaign.OwnerId equals owner.Id
        orderby campaign.Start descending
        select new
        {
            campaign.Id, campaign.Name, campaign.Goal, campaign.Description, campaign.Channel, campaign.Segment,
            campaign.Status, campaign.Start, campaign.End, campaign.Reached, campaign.Leads, owner = owner.Name,
            audienceIds = campaign.Audience.Select(x => x.Id).ToList(),
            audience = campaign.Audience.OrderBy(x => x.Name).Select(x => new { x.Id, x.Name, x.Kind }).ToList()
        }).ToListAsync());

    private static async Task<IResult> Save(int? id, CampaignInput input, ClaimsPrincipal user, CrmDb db)
    {
        if (!Text(input.Name, 150, true) || !Text(input.Goal, 200, true) || !Text(input.Description, 500) ||
            !Text(input.Segment, 150) || !CampaignAssistant.Channels.Contains(input.Channel) ||
            input.Status is not ("Planeada" or "Activa" or "Finalizada" or "Pausada") ||
            input.Start == default || input.End < input.Start || input.Reached < 0 || input.Leads < 0 ||
            input.AudienceIds is null || input.AudienceIds.Length > 1000)
            return Error("Revisa los datos, fechas y resultados de la campaña.");

        var campaign = id is null ? new Campaign { OwnerId = user.UserId() }
            : await db.Campaigns.Include(x => x.Audience).SingleOrDefaultAsync(x => x.Id == id);
        if (campaign is null) return Results.NotFound();
        var ids = input.AudienceIds.Distinct().ToArray();
        var existingIds = campaign.Audience.Select(x => x.Id).ToArray();
        var audience = await db.Parties.Where(x => ids.Contains(x.Id) && (x.Active || existingIds.Contains(x.Id))).ToListAsync();
        if (ids.Length != audience.Count) return Error("Selecciona clientes o prospectos disponibles.");
        campaign.Name = Clean(input.Name);
        campaign.Goal = Clean(input.Goal);
        campaign.Description = Clean(input.Description);
        campaign.Segment = Clean(input.Segment);
        campaign.Channel = input.Channel;
        campaign.Status = input.Status;
        campaign.Start = input.Start;
        campaign.End = input.End;
        campaign.Reached = input.Reached;
        campaign.Leads = input.Leads;
        campaign.Audience = audience;
        campaign.Revision = Guid.NewGuid();
        if (id is null) db.Campaigns.Add(campaign);
        await db.SaveChangesAsync();
        return Results.NoContent();
    }

    private sealed record CampaignInput(string? Name, string? Goal, string Channel, string Status, DateOnly Start,
        DateOnly End, int Reached, int Leads, int[] AudienceIds, string? Description = null, string? Segment = null);
}
