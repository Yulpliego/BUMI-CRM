using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace NexoCrm;

public static class AuthEndpoints
{
    public static void Map(WebApplication app)
    {
        var auth = app.MapGroup("/api/auth");
        auth.MapPost("/login", Login).RequireRateLimiting("login");
        auth.MapGet("/me", (ClaimsPrincipal user, CrmDb db) => Profile(user, db)).RequireAuthorization();
        auth.MapPost("/logout", async (HttpContext context) =>
        {
            await context.SignOutAsync();
            return Results.NoContent();
        }).RequireAuthorization();
        auth.MapPost("/password", ChangePassword).RequireAuthorization();

        app.MapPut("/api/config/{key}", async (string key, Toggle input, CrmDb db) =>
        {
            var setting = await db.Modules.FindAsync(key);
            if (setting is null) return Results.NotFound();
            setting.Enabled = input.Enabled;
            await db.SaveChangesAsync();
            return Results.Ok(setting);
        }).RequireAuthorization(policy => policy.RequireRole("Administrador"));
    }

    private static async Task<IResult> Login(Credentials input, HttpContext context, CrmDb db, IPasswordHasher<Account> hasher)
    {
        if (!CrmRules.Text(input.Email, 160, true) || input.Password is not { Length: > 0 and <= 128 })
            return Results.Unauthorized();

        var email = CrmRules.Clean(input.Email).ToLowerInvariant();
        var account = await db.Accounts.SingleOrDefaultAsync(x => x.Email == email);
        if (account is null || !account.Active ||
            hasher.VerifyHashedPassword(account, account.PasswordHash, input.Password) == PasswordVerificationResult.Failed)
            return Results.Unauthorized();

        var identity = new ClaimsIdentity(
            [
                new(ClaimTypes.NameIdentifier, account.Id.ToString()),
                new(ClaimTypes.Name, account.Name),
                new(ClaimTypes.Role, account.Role),
                new("version", account.SessionVersion.ToString())
            ], CookieAuthenticationDefaults.AuthenticationScheme);
        var principal = new ClaimsPrincipal(identity);
        await context.SignInAsync(principal);
        return await Profile(principal, db);
    }

    private static async Task<IResult> Profile(ClaimsPrincipal user, CrmDb db)
    {
        var settings = await db.Modules.OrderBy(x => x.Key).ToListAsync();
        var modules = settings.Where(x => CrmRules.Modules[x.Key].Any(user.IsInRole));
        return Results.Ok(new { name = user.Identity!.Name, role = user.FindFirstValue(ClaimTypes.Role), modules });
    }

    private static async Task<IResult> ChangePassword(PasswordChange input, HttpContext context, CrmDb db,
        IPasswordHasher<Account> hasher)
    {
        if (input.NewPassword is not { Length: >= 12 and <= 128 } || input.Current is not { Length: > 0 and <= 128 })
            return CrmRules.Error("Usa una contraseña nueva de 12 a 128 caracteres.");
        var account = (await db.Accounts.FindAsync(context.User.UserId()))!;
        if (hasher.VerifyHashedPassword(account, account.PasswordHash, input.Current) == PasswordVerificationResult.Failed)
            return CrmRules.Error("La contraseña actual es incorrecta.");
        account.PasswordHash = hasher.HashPassword(account, input.NewPassword);
        account.SessionVersion = Guid.NewGuid();
        await db.SaveChangesAsync();
        await context.SignOutAsync();
        return Results.NoContent();
    }

    private sealed record Credentials(string? Email, string? Password);
    private sealed record PasswordChange(string? Current, string? NewPassword);
    private sealed record Toggle(bool Enabled);
}
