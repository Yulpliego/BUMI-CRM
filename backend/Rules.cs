using System.Security.Claims;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;

namespace NexoCrm;

public static class CrmRules
{
    public static readonly string[] Commercial = ["Administrador", "Gerente", "Vendedor"];
    public static readonly string[] Managers = ["Administrador", "Gerente"];
    public static readonly string[] Marketing = ["Administrador", "Gerente", "Marketing"];
    public static readonly string[] OpportunityStages = ["Nueva", "En seguimiento", "Propuesta", "Negociación", "Ganada", "Perdida"];
    public static readonly Dictionary<string, string[]> Modules = new()
    {
        ["estadisticas"] = Commercial,
        ["clientes"] = Commercial,
        ["marketing"] = Marketing,
        ["cotizaciones"] = Commercial,
        ["ventas"] = Commercial
    };

    private static readonly TimeZoneInfo Mexico = TimeZoneInfo.FindSystemTimeZoneById("America/Mexico_City");
    public static DateOnly Today() => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, Mexico).DateTime);
    public static decimal Round(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);
    public static int UserId(this ClaimsPrincipal user) => int.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)!);
    public static bool IsManager(this ClaimsPrincipal user) => Managers.Any(user.IsInRole);
    public static bool CanSee(this ClaimsPrincipal user, int ownerId) => user.IsManager() || ownerId == user.UserId();
    public static string Clean(string? value) => value?.Trim() ?? "";
    public static bool Text(string? value, int length, bool required = false)
        => Clean(value).Length <= length && (!required || Clean(value).Length > 0);
    public static bool Email(string? value) => Clean(value) == "" ||
        (Text(value, 160) && Regex.IsMatch(Clean(value), @"^[^\s@]+@[^\s@]+\.[^\s@]+$"));
    public static IResult Error(string message) => Results.BadRequest(new { message });
    public static IResult Conflict(string message) => Results.Conflict(new { message });

    public static RouteGroupBuilder Module(this WebApplication app, string key)
    {
        var group = app.MapGroup("/api/" + key).RequireAuthorization(policy => policy.RequireRole(Modules[key]));
        group.AddEndpointFilter(async (context, next) =>
        {
            var db = context.HttpContext.RequestServices.GetRequiredService<CrmDb>();
            if (!await db.Modules.AnyAsync(x => x.Key == key && x.Enabled))
                return Results.Json(new { message = "El módulo está desactivado." }, statusCode: 403);
            return await next(context);
        });
        return group;
    }
}
