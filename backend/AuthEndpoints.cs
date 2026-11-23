using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace NexoCrm;

public static class AuthEndpoints
{
    private const string ChallengeCookie = "Bumi.Challenge";
    private const int MaxAttempts = 5;

    public static void Map(WebApplication app)
    {
        var auth = app.MapGroup("/api/auth");
        auth.MapPost("/login", Login).RequireRateLimiting("login");
        auth.MapPost("/verify", Verify).RequireRateLimiting("verify");
        auth.MapGet("/challenge", Resume);
        auth.MapPost("/challenge/rotate", RotateSetup).RequireRateLimiting("login");
        auth.MapDelete("/challenge", CancelChallenge);
        auth.MapPost("/recover", Recover).RequireRateLimiting("login");
        auth.MapPost("/recovery/backup", RecoverWithBackup).RequireRateLimiting("password-backup");
        auth.MapGet("/me", (ClaimsPrincipal user, CrmDb db) => Profile(user, db)).RequireAuthorization();
        auth.MapPost("/logout", async (HttpContext context, CrmDb db) =>
        {
            await SessionAccess.RevokeCurrent(context, db);
            await context.SignOutAsync();
            return Results.NoContent();
        }).RequireAuthorization();
        auth.MapPost("/password", ChangePassword).RequireAuthorization();
        auth.MapPost("/authenticator/reset", ResetAuthenticator).RequireAuthorization().RequireRateLimiting("authenticator-management");
        auth.MapGet("/authenticator/phones", async (ClaimsPrincipal user, CrmDb db) =>
        {
            var factor = await db.AccountFactors.FindAsync(user.UserId());
            return Results.Ok(new { linked = factor is { Confirmed: true }, additional = factor?.AdditionalSecret is not null });
        }).RequireAuthorization();
        auth.MapPost("/authenticator/phones/remove", RemovePhone).RequireAuthorization().RequireRateLimiting("authenticator-management");

        var admin = app.MapGroup("/api/config").RequireAuthorization(policy => policy.RequireRole("Administrador"));
        var managers = app.MapGroup("/api/config").RequireAuthorization(policy => policy.RequireRole(CrmRules.Managers));
        admin.MapPut("/{key}", async (string key, Toggle input, CrmDb db) =>
        {
            var setting = await db.Modules.FindAsync(key);
            if (setting is null) return Results.NotFound();
            setting.Enabled = input.Enabled;
            await db.SaveChangesAsync();
            return Results.Ok(setting);
        });
        managers.MapGet("/accounts", async (ClaimsPrincipal user, CrmDb db) =>
        {
            var actorId = user.UserId();
            return Results.Ok(await db.Accounts.Where(account => account.DeletedAt == null).OrderBy(account => account.Name)
                .Select(account => new { account.Id, account.Name, account.Email, account.Role, account.Active,
                    current = account.Id == actorId,
                    lastSession = db.AccountSessions.Where(x => x.AccountId == account.Id).Max(x => (DateTimeOffset?)x.Started)
                }).ToListAsync());
        });
        managers.MapGet("/permisos", () => Results.Ok(new
        {
            roles = CrmRules.Team,
            modules = CrmRules.Modules,
            writers = new Dictionary<string, string[]>
            {
                ["clientes"] = CrmRules.Commercial, ["cotizaciones"] = CrmRules.Commercial,
                ["ventas"] = CrmRules.Commercial, ["marketing"] = CrmRules.Marketing,
                ["agenda"] = CrmRules.Team, ["historial"] = CrmRules.Commercial,
                ["notificaciones"] = CrmRules.Team, ["inventario"] = CrmRules.StockEditors,
                ["proveedores"] = CrmRules.SuppliersEditors
            }
        }));
        admin.MapPut("/accounts/{id:int}/rol", AssignRole);
        admin.MapPut("/accounts/{id:int}", ToggleAccount);
        admin.MapDelete("/accounts/{id:int}", DeleteAccount);
    }

    private static async Task<IResult> Login(Credentials input, HttpContext context, CrmDb db,
        IPasswordHasher<Account> hasher, Authenticator authenticator)
    {
        if (!CrmRules.Text(input.Email, 160, true) || input.Password is not { Length: > 0 and <= 128 })
            return Results.Unauthorized();

        var email = CrmRules.Clean(input.Email).ToLowerInvariant();
        var account = await db.Accounts.SingleOrDefaultAsync(x => x.Email == email);
        if (account is null || !account.Active ||
            hasher.VerifyHashedPassword(account, account.PasswordHash, input.Password) == PasswordVerificationResult.Failed)
            return Results.Unauthorized();

        var factor = await db.AccountFactors.FindAsync(account.Id);
        if (factor is null)
        {
            var secret = authenticator.Protect(RandomNumberGenerator.GetBytes(20));
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO "AccountFactors" ("AccountId", "Secret", "LastStep", "Confirmed")
                VALUES ({account.Id}, {secret}, -1, false)
                ON CONFLICT ("AccountId") DO NOTHING
                """);
            factor = (await db.AccountFactors.FindAsync(account.Id))!;
        }
        var now = DateTimeOffset.UtcNow;
        var challenge = new LoginChallenge
        {
            AccountId = account.Id, SessionVersion = account.SessionVersion, ExpiresAt = now.AddMinutes(5),
            PendingSecret = factor.Confirmed ? null : factor.Secret
        };
        Guid.TryParse(context.Request.Cookies[ChallengeCookie], out var previous);
        await db.LoginChallenges.Where(item => item.ExpiresAt <= now || item.Id == previous).ExecuteDeleteAsync();
        db.LoginChallenges.Add(challenge);
        await db.SaveChangesAsync();
        await context.SignOutAsync();
        var options = ChallengeOptions(context);
        options.Expires = challenge.ExpiresAt;
        context.Response.Cookies.Append(ChallengeCookie, challenge.Id.ToString("N"), options);
        return await ChallengeResponse(challenge, account, authenticator, db);
    }

    private static async Task<IResult> Resume(HttpContext context, CrmDb db, Authenticator authenticator)
    {
        var pending = await GetChallenge(context, db);
        if (pending is null) return Results.NoContent();
        var (challenge, account, _) = pending.Value;
        return await ChallengeResponse(challenge, account, authenticator, db);
    }

    private static async Task<IResult> RotateSetup(HttpContext context, CrmDb db, Authenticator authenticator)
    {
        var pending = await GetChallenge(context, db);
        if (pending is null) return Expired(context);
        var (challenge, account, factor) = pending.Value;
        if (factor.Confirmed && !challenge.Replacement) return CrmRules.Conflict("Tu autenticador ya está vinculado.");
        challenge.PendingSecret = authenticator.Protect(RandomNumberGenerator.GetBytes(20));
        if (!challenge.Replacement) factor.Secret = challenge.PendingSecret;
        await db.SaveChangesAsync();
        return await ChallengeResponse(challenge, account, authenticator, db);
    }

    private static async Task<IResult> CancelChallenge(HttpContext context, CrmDb db)
    {
        if (Guid.TryParse(context.Request.Cookies[ChallengeCookie], out var id))
            await db.LoginChallenges.Where(item => item.Id == id).ExecuteDeleteAsync();
        DropChallenge(context);
        return Results.NoContent();
    }

    internal static async Task<(LoginChallenge Challenge, Account Account, AccountFactor Factor)?> GetChallenge(
        HttpContext context, CrmDb db)
    {
        if (!Guid.TryParse(context.Request.Cookies[ChallengeCookie], out var id)) return null;
        var challenge = await db.LoginChallenges.FindAsync(id);
        if (challenge is null || challenge.ExpiresAt <= DateTimeOffset.UtcNow || challenge.Attempts >= MaxAttempts)
            return null;
        var account = await db.Accounts.FindAsync(challenge.AccountId);
        if (account is null || !account.Active || account.SessionVersion != challenge.SessionVersion) return null;
        var factor = await db.AccountFactors.FindAsync(account.Id);
        if (factor is null) return null;
        if (challenge.Replacement ? !factor.Confirmed || challenge.PendingSecret is null :
            challenge.PendingSecret != (factor.Confirmed ? null : factor.Secret)) return null;
        return (challenge, account, factor);
    }

    private static async Task<IResult> ChallengeResponse(LoginChallenge challenge, Account account, Authenticator authenticator, CrmDb db) =>
        Results.Ok(new
        {
            email = account.Email,
            setup = challenge.PendingSecret is { } secret ? authenticator.CreateSetup(account.Email, secret) : null,
            expiresAt = challenge.ExpiresAt,
            replacement = challenge.Replacement && !challenge.AddPhone,
            addPhone = challenge.AddPhone,
            hasPasskey = challenge.PendingSecret is null && await db.BumiPasskeys.AnyAsync(x => x.AccountId == account.Id)
        });

    private static async Task<IResult> Verify(FactorInput input, HttpContext context, CrmDb db, Authenticator authenticator)
    {
        var pending = await GetChallenge(context, db);
        if (pending is null) return Expired(context);
        var (challenge, account, factor) = pending.Value;
        var enrolling = !factor.Confirmed || challenge.Replacement;
        var secret = challenge.Replacement ? challenge.PendingSecret! : factor.Secret;
        var step = input.UseRecovery ? null : authenticator.Verify(secret, input.Code, challenge.Replacement ? -1 : factor.LastStep);
        var otherStep = !enrolling && !input.UseRecovery && step is null && factor.AdditionalSecret is { } otherSecret
            ? authenticator.Verify(otherSecret, input.Code, factor.AdditionalLastStep) : null;
        var backup = !enrolling && input.UseRecovery
            ? await Authenticator.FindRecovery(account.Id, input.Code, db) : null;
        if (step is null && backup is null && otherStep is null)
        {
            challenge.Attempts++;
            await db.SaveChangesAsync();
            return challenge.Attempts >= MaxAttempts ? Expired(context) :
                CrmRules.Error("El código es incorrecto, ya se usó o venció. Intenta con un código nuevo.");
        }

        string[]? recoveryCodes = null;
        if (challenge.AddPhone)
        {
            if (factor.AdditionalSecret is not null) return Expired(context);
            factor.AdditionalSecret = secret;
            factor.AdditionalLastStep = step!.Value;
            account.SessionVersion = Guid.NewGuid();
        }
        else if (step.HasValue) factor.LastStep = step.Value;
        if (otherStep.HasValue) factor.AdditionalLastStep = otherStep.Value;
        if (challenge.Replacement && !challenge.AddPhone)
        {
            factor.Secret = secret;
            account.SessionVersion = Guid.NewGuid();
            db.RecoveryCodes.RemoveRange(await db.RecoveryCodes.Where(item => item.AccountId == account.Id).ToListAsync());
        }
        if (enrolling && !challenge.AddPhone)
        {
            factor.Confirmed = true;
            recoveryCodes = Authenticator.AddRecoveryCodes(account.Id, db);
        }
        if (backup is not null) db.RecoveryCodes.Remove(backup);
        db.LoginChallenges.Remove(challenge);
        var session = SessionAccess.Create(context, account, db);
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateConcurrencyException) { return Expired(context); }
        catch (DbUpdateException error) when (error.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return Expired(context);
        }

        var principal = await SessionAccess.SignIn(context, account, session);
        DropChallenge(context);
        return Results.Ok(new { profile = await GetProfile(principal, db), recoveryCodes });
    }

    private static async Task<IResult> Profile(ClaimsPrincipal user, CrmDb db) => Results.Ok(await GetProfile(user, db));

    internal static async Task<object> GetProfile(ClaimsPrincipal user, CrmDb db)
    {
        var settings = await db.Modules.OrderBy(x => x.Key).ToListAsync();
        var modules = settings.Where(x => CrmRules.Modules[x.Key].Any(user.IsInRole));
        return new { name = user.Identity!.Name, role = user.FindFirstValue(ClaimTypes.Role), modules };
    }

    private static async Task<IResult> ChangePassword(PasswordChange input, HttpContext context, CrmDb db,
        IPasswordHasher<Account> hasher)
    {
        if (!ValidNewPassword(input.NewPassword)) return CrmRules.Error("Usa una contraseña nueva de 12 a 128 caracteres.");
        var account = (await db.Accounts.FindAsync(context.User.UserId()))!;
        if (!MatchesPassword(input.Current, account, hasher))
            return CrmRules.Error("La contraseña actual es incorrecta.");
        SetPassword(account, input.NewPassword!, hasher);
        await db.SaveChangesAsync();
        await context.SignOutAsync();
        return Results.NoContent();
    }

    private static async Task<IResult> Recover(RecoveryInput input, HttpContext context, CrmDb db,
        IPasswordHasher<Account> hasher, Authenticator authenticator)
    {
        if (!ValidNewPassword(input.Password)) return CrmRules.Error("Usa una contraseña nueva de 12 a 128 caracteres.");
        var email = CrmRules.Clean(input.Email).ToLowerInvariant();
        if (!CrmRules.Text(email, 160, true)) return InvalidRecovery();
        var account = await db.Accounts.SingleOrDefaultAsync(x => x.Email == email && x.Active);
        if (account is null) return InvalidRecovery();
        var factor = await db.AccountFactors.FindAsync(account.Id);
        var backup = await Authenticator.FindRecovery(account.Id, input.RecoveryCode, db);
        var step = factor is { Confirmed: true } ? authenticator.Verify(factor.Secret, input.Code, factor.LastStep) : null;
        if (backup is null || step is null) return InvalidRecovery();
        factor!.LastStep = step.Value;
        db.RecoveryCodes.Remove(backup);
        SetPassword(account, input.Password!, hasher);
        await db.SaveChangesAsync();
        await context.SignOutAsync();
        DropChallenge(context);
        return Results.NoContent();
    }

    private static async Task<IResult> RecoverWithBackup(BackupRecoveryInput input, HttpContext context, CrmDb db,
        IPasswordHasher<Account> hasher)
    {
        static IResult InvalidBackup() => CrmRules.Error("El código de respaldo no es válido o ya se usó.");

        if (input.Password is not null && !ValidNewPassword(input.Password))
            return CrmRules.Error("Usa una contraseña nueva de 12 a 128 caracteres.");
        var hash = Authenticator.RecoveryDigest(input.RecoveryCode);
        if (hash is null) return InvalidBackup();

        var matches = await (from backup in db.RecoveryCodes
                             join account in db.Accounts on backup.AccountId equals account.Id
                             join factor in db.AccountFactors on account.Id equals factor.AccountId
                             where backup.Hash == hash && account.Active && factor.Confirmed
                             orderby backup.AccountId
                             select new { Backup = backup, Account = account }).Take(2).ToListAsync();
        if (matches.Count != 1) return InvalidBackup();
        if (input.Password is null) return Results.NoContent();

        var match = matches[0];
        db.RecoveryCodes.Remove(match.Backup);
        SetPassword(match.Account, input.Password, hasher);
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateConcurrencyException) { return InvalidBackup(); }
        await context.SignOutAsync();
        DropChallenge(context);
        return Results.NoContent();
    }

    private static async Task<IResult> ResetAuthenticator(ResetInput input, HttpContext context, CrmDb db,
        IPasswordHasher<Account> hasher, Authenticator authenticator)
    {
        var account = (await db.Accounts.FindAsync(context.User.UserId()))!;
        if (!MatchesPassword(input.Password, account, hasher)) return CrmRules.Error("La contraseña es incorrecta.");
        var factor = await db.AccountFactors.FindAsync(account.Id);
        if (factor is not { Confirmed: true }) return CrmRules.Conflict("Vincula primero un autenticador para tu cuenta.");

        if (input.AddPhone && factor.AdditionalSecret is not null)
            return CrmRules.Conflict("Ya tienes un segundo teléfono vinculado. Retíralo antes de agregar otro.");
        var now = DateTimeOffset.UtcNow;
        var challenge = new LoginChallenge { AccountId = account.Id, SessionVersion = account.SessionVersion,
            PendingSecret = authenticator.Protect(RandomNumberGenerator.GetBytes(20)), ExpiresAt = now.AddMinutes(5),
            Replacement = true, AddPhone = input.AddPhone };
        Guid.TryParse(context.Request.Cookies[ChallengeCookie], out var previous);
        await db.LoginChallenges.Where(item => item.ExpiresAt <= now || item.Id == previous).ExecuteDeleteAsync();
        db.LoginChallenges.Add(challenge);
        await db.SaveChangesAsync();
        await SessionAccess.RevokeCurrent(context, db);
        await context.SignOutAsync();
        var options = ChallengeOptions(context);
        options.Expires = challenge.ExpiresAt;
        context.Response.Cookies.Append(ChallengeCookie, challenge.Id.ToString("N"), options);
        return Results.NoContent();
    }

    private static async Task<IResult> RemovePhone(ResetInput input, HttpContext context, CrmDb db, IPasswordHasher<Account> hasher)
    {
        var account = (await db.Accounts.FindAsync(context.User.UserId()))!;
        if (!MatchesPassword(input.Password, account, hasher)) return CrmRules.Error("La contraseña es incorrecta.");
        var factor = await db.AccountFactors.FindAsync(account.Id);
        if (factor?.AdditionalSecret is null) return Results.NoContent();
        factor.AdditionalSecret = null;
        factor.AdditionalLastStep = -1;
        account.SessionVersion = Guid.NewGuid();
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateConcurrencyException) { return CrmRules.Conflict("La cuenta cambió. Vuelve a intentarlo."); }
        await context.SignOutAsync();
        DropChallenge(context);
        return Results.NoContent();
    }

    private static async Task<IResult> ToggleAccount(int id, AccountToggle input, ClaimsPrincipal user, CrmDb db)
    {
        if (id == user.UserId() && !input.Active) return CrmRules.Error("No puedes desactivar tu propia cuenta.");
        var account = await db.Accounts.FindAsync(id);
        if (account is null || account.DeletedAt.HasValue) return Results.NotFound();
        if (account.Active != input.Active)
        {
            account.Active = input.Active;
            account.SessionVersion = Guid.NewGuid();
            try { await db.SaveChangesAsync(); }
            catch (DbUpdateConcurrencyException) { return CrmRules.Conflict("Esta cuenta cambió. Actualiza la página y vuelve a intentarlo."); }
        }
        return Results.NoContent();
    }

    private static async Task<IResult> AssignRole(int id, AccountRole input, ClaimsPrincipal user, CrmDb db)
    {
        if (id == user.UserId()) return CrmRules.Error("Tu propio rol se administra desde otra cuenta de administración.");
        if (!CrmRules.Team.Contains(input.Role)) return CrmRules.Error("Selecciona un rol válido.");
        var account = await db.Accounts.FindAsync(id);
        if (account is null || account.DeletedAt.HasValue) return Results.NotFound();
        if (account.Role == input.Role) return Results.NoContent();

        account.Role = input.Role;
        account.SessionVersion = Guid.NewGuid();
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateConcurrencyException) { return CrmRules.Conflict("Esta cuenta cambió. Actualiza la página y vuelve a intentarlo."); }
        return Results.NoContent();
    }

    private static async Task<IResult> DeleteAccount(int id, ClaimsPrincipal user, CrmDb db)
    {
        if (id == user.UserId()) return CrmRules.Error("No puedes eliminar tu propia cuenta.");
        var account = await db.Accounts.FindAsync(id);
        if (account is null) return Results.NotFound();
        if (account.DeletedAt.HasValue) return Results.NoContent();

        account.DeletedAt = DateTimeOffset.UtcNow;
        account.Active = false;
        account.SessionVersion = Guid.NewGuid();
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateConcurrencyException) { return CrmRules.Conflict("Esta cuenta cambió. Actualiza la página y vuelve a intentarlo."); }
        return Results.NoContent();
    }

    internal static bool ValidNewPassword(string? password) => password is { Length: >= 12 and <= 128 };
    internal static bool MatchesPassword(string? password, Account account, IPasswordHasher<Account> hasher)
        => password is { Length: > 0 and <= 128 } &&
            hasher.VerifyHashedPassword(account, account.PasswordHash, password) != PasswordVerificationResult.Failed;
    internal static void SetPassword(Account account, string password, IPasswordHasher<Account> hasher)
    {
        account.PasswordHash = hasher.HashPassword(account, password);
        account.SessionVersion = Guid.NewGuid();
    }
    private static IResult InvalidRecovery() => CrmRules.Error("No se pudo recuperar la cuenta. Revisa el correo y los dos códigos.");
    private static CookieOptions ChallengeOptions(HttpContext context) => new()
    {
        HttpOnly = true, Secure = context.Request.IsHttps ||
            !context.RequestServices.GetRequiredService<IHostEnvironment>().IsDevelopment(),
        SameSite = SameSiteMode.Strict, Path = "/api/auth"
    };
    internal static void DropChallenge(HttpContext context)
        => context.Response.Cookies.Delete(ChallengeCookie, ChallengeOptions(context));
    private static IResult Expired(HttpContext context)
    {
        DropChallenge(context);
        return Results.Json(new { message = "La verificación terminó. Ingresa tu correo y contraseña de nuevo." }, statusCode: 410);
    }

    private sealed record Credentials(string? Email, string? Password);
    private sealed record FactorInput(string? Code, bool UseRecovery = false);
    private sealed record PasswordChange(string? Current, string? NewPassword);
    private sealed record RecoveryInput(string? Email, string? Code, string? RecoveryCode, string? Password);
    private sealed record BackupRecoveryInput(string? RecoveryCode, string? Password);
    private sealed record ResetInput(string? Password, bool AddPhone = false);
    private sealed record AccountToggle(bool Active);
    private sealed record AccountRole(string Role);
    private sealed record Toggle(bool Enabled);
}
