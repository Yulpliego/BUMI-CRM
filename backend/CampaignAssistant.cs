using System.Globalization;
using System.Text;
using Microsoft.EntityFrameworkCore;
using static NexoCrm.CrmRules;

namespace NexoCrm;

internal static class CampaignAssistant
{
    internal static readonly string[] Channels = ["Email", "Eventos", "Redes sociales", "Teléfono", "Otro"];

    private static readonly Strategy[] Strategies =
    [
        new("Email", "Envía un correo breve con una propuesta concreta y una llamada a la acción.",
            "Compara respuestas y solicitudes de cotización.", ["correo", "email", "catalogo", "seguimiento", "oferta"]),
        new("Eventos", "Invita al público a una demostración o sesión breve de preguntas.",
            "Mide inscripciones, asistencia y reuniones solicitadas.", ["demostracion", "webinar", "feria", "evento", "taller"]),
        new("Redes sociales", "Publica un caso práctico y enlaza un formulario de interés.",
            "Mide clics y formularios con datos de contacto.", ["redes", "alcance", "difusion", "marca", "visibilidad"]),
        new("Teléfono", "Agenda una llamada para confirmar la necesidad y ofrecer el siguiente paso.",
            "Registra conversaciones, reuniones y cotizaciones solicitadas.", ["cita", "llamada", "urgente", "llamar", "reactivar"]),
    ];

    public static async Task<IResult> Suggest(AssistantInput input, CrmDb db, CancellationToken cancellation)
    {
        var need = Clean(input.Need);
        var objective = Clean(input.Objective);
        if (!Text(need, 250, true) || need.Length < 8 || objective is not ("Captar prospectos" or "Generar cotizaciones" or "Reactivar clientes"))
            return Error("Indica un objetivo y describe la necesidad en 8 a 250 caracteres.");

        var client = await db.Parties.Where(x => x.Id == input.PartyId && x.Active)
            .Select(x => new { x.Id, x.Name, x.Kind, x.Industry, x.Email, x.Phone }).SingleOrDefaultAsync(cancellation);
        if (client is null) return Error("Selecciona un cliente o prospecto activo.");

        var history = await db.Campaigns.AsNoTracking()
            .Where(x => x.Status == "Finalizada" && x.Reached > 0 && x.Leads >= 0 && x.Leads <= x.Reached)
            .GroupBy(x => x.Channel).Select(group => new { Channel = group.Key, Count = group.Count(),
                Reached = group.Sum(x => (long)x.Reached), Leads = group.Sum(x => (long)x.Leads) })
            .ToListAsync(cancellation);

        var normalized = Normalize(need);
        var ranked = Strategies
            .Where(strategy => strategy.Channel switch
            {
                "Email" => !string.IsNullOrWhiteSpace(client.Email),
                "Teléfono" => !string.IsNullOrWhiteSpace(client.Phone),
                _ => true
            })
            .Select(strategy =>
            {
                var precedent = history.Find(item => item.Channel == strategy.Channel);
                var intent = strategy.Signals.Count(signal => normalized.Contains(signal, StringComparison.Ordinal));
                var affinity = (objective, strategy.Channel) switch
                {
                    ("Captar prospectos", "Redes sociales") => 2,
                    ("Captar prospectos", "Eventos") => 1,
                    ("Generar cotizaciones", "Email") => 2,
                    ("Generar cotizaciones", "Teléfono") => 1,
                    ("Reactivar clientes", "Teléfono") => 2,
                    ("Reactivar clientes", "Email") => 1,
                    _ => 0
                };
                var observed = precedent is null ? null : (decimal?)precedent.Leads / precedent.Reached;
                var adjusted = precedent is null ? 0m : (decimal)precedent.Leads / (precedent.Reached + 25m);
                return new { strategy, precedent, observed, score = intent * 3 + affinity + adjusted };
            })
            .OrderByDescending(item => item.score).ThenBy(item => item.strategy.Channel)
            .Take(3)
            .Select(item => new { channel = item.strategy.Channel, action = item.strategy.Action, measure = item.strategy.Measure,
                historyCount = item.precedent?.Count ?? 0, historicalRate = item.observed })
            .ToArray();

        return Results.Ok(new
        {
            client.Id, client.Name, client.Kind,
            segment = string.IsNullOrWhiteSpace(client.Industry) ? client.Kind : Clipped(client.Industry, 150),
            campaignName = Clipped(objective + " · " + client.Name, 150),
            goal = Clipped(objective + " para " + client.Name, 200),
            need,
            options = ranked
        });
    }

    private static string Normalize(string value)
    {
        var builder = new StringBuilder();
        foreach (var character in value.Normalize(NormalizationForm.FormD))
            if (CharUnicodeInfo.GetUnicodeCategory(character) != UnicodeCategory.NonSpacingMark)
                builder.Append(char.ToLowerInvariant(character));
        return builder.ToString();
    }

    private static string Clipped(string value, int limit) => value.Length <= limit ? value : value[..limit].TrimEnd();
    private sealed record Strategy(string Channel, string Action, string Measure, string[] Signals);
    internal sealed record AssistantInput(int PartyId, string? Objective, string? Need);
}

