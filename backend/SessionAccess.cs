using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using static NexoCrm.CrmRules;

namespace NexoCrm;

internal static class SessionAccess
{
    public static void Map(WebApplication app)
    {
        var auth = app.MapGroup("/api/auth");
        auth.MapGet("/sesiones", List).RequireAuthorization();
        auth.MapDelete("/sesiones/{id:guid}", Revoke).RequireAuthorization();
        auth.MapDelete("/sesiones/otras", RevokeOthers).RequireAuthorization();
        auth.MapGet("/llaves", ListKeys).RequireAuthorization();
        auth.MapPost("/llaves/opciones", CreationOptions).RequireAuthorization().RequireRateLimiting("login");
        auth.MapPost("/llaves", Register).RequireAuthorization().RequireRateLimiting("verify");
        auth.MapDelete("/llaves/{id:int}", DeleteKey).RequireAuthorization();
        auth.MapPost("/llaves/verificacion/opciones", RequestOptions).RequireRateLimiting("verify");
        auth.MapPost("/llaves/verificacion", Verify).RequireRateLimiting("verify");
    }

    public static Guid? Current(ClaimsPrincipal user) =>
        Guid.TryParse(user.FindFirstValue("sid"), out var id) ? id : null;

    public static AccountSession Create(HttpContext context, Account account, CrmDb db)
    {
        var agent = context.Request.Headers.UserAgent.ToString();
        var session = new AccountSession { AccountId = account.Id, Version = account.SessionVersion,
            Device = agent[..Math.Min(agent.Length, 240)] };
        db.AccountSessions.Add(session);
        return session;
    }

    public static async Task<ClaimsPrincipal> SignIn(HttpContext context, Account account, AccountSession session)
    {
        var identity = new ClaimsIdentity([
            new(ClaimTypes.NameIdentifier, account.Id.ToString()),
            new(ClaimTypes.Name, account.Name), new(ClaimTypes.Role, account.Role),
            new("version", account.SessionVersion.ToString()), new("amr", "mfa"), new("sid", session.Id.ToString())
        ], CookieAuthenticationDefaults.AuthenticationScheme);
        var user = new ClaimsPrincipal(identity);
        await context.SignInAsync(user, new AuthenticationProperties { IssuedUtc = session.Started, ExpiresUtc = session.Expires });
        return user;
    }

    private static async Task<IResult> List(ClaimsPrincipal user, CrmDb db)
    {
        var account = (await db.Accounts.FindAsync(user.UserId()))!;
        var current = Current(user);
        var now = DateTimeOffset.UtcNow;
        return Results.Ok(await db.AccountSessions.Where(x => x.AccountId == account.Id && x.Version == account.SessionVersion &&
            !x.Revoked && x.Expires > now).OrderByDescending(x => x.Started)
            .Select(x => new { x.Id, x.Device, x.Started, x.Expires, current = x.Id == current }).ToListAsync());
    }

    internal static async Task RevokeCurrent(HttpContext context, CrmDb db)
    {
        var id = Current(context.User);
        if (id.HasValue)
            await db.AccountSessions.Where(x => x.Id == id && x.AccountId == context.User.UserId())
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.Revoked, true));
    }

    private static async Task<IResult> Revoke(Guid id, HttpContext context, CrmDb db)
    {
        var current = Current(context.User);
        var count = await db.AccountSessions.Where(x => x.Id == id && x.AccountId == context.User.UserId())
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.Revoked, true));
        if (count == 0) return Results.NotFound();
        if (current == id) await context.SignOutAsync();
        return Results.NoContent();
    }

    private static async Task<IResult> RevokeOthers(ClaimsPrincipal user, CrmDb db)
    {
        if (Current(user) is not { } current) return Results.Unauthorized();
        var accountId = user.UserId();
        await db.AccountSessions.Where(x => x.AccountId == accountId && x.Id != current && !x.Revoked)
            .ExecuteUpdateAsync(change => change.SetProperty(x => x.Revoked, true));
        return Results.NoContent();
    }

    private static bool Supported(HttpContext ctx) =>
        !System.Net.IPAddress.TryParse(ctx.Request.Host.Host, out _) &&
        (ctx.Request.IsHttps || ctx.Request.Host.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase));

    private static async Task<IResult> ListKeys(HttpContext context, CrmDb db)
    {
        var keys = await db.BumiPasskeys.Where(x => x.AccountId == context.User.UserId()).OrderByDescending(x => x.Added)
            .Select(x => new { x.Id, x.Name, x.Added }).ToListAsync();
        return Results.Ok(new { supported = Supported(context), keys });
    }

    private static async Task<IResult> CreationOptions(SetupInput input, HttpContext context, CrmDb db,
        IPasskeyHandler<Account> handler, IPasswordHasher<Account> hasher)
    {
        if (!Supported(context)) return Error("Abre BUMI mediante HTTPS o localhost para registrar una llave.");
        var account = (await db.Accounts.FindAsync(context.User.UserId()))!;
        if (!AuthEndpoints.MatchesPassword(input.Password, account, hasher)) return Error("La contraseña actual es incorrecta.");
        if (await db.BumiPasskeys.CountAsync(x => x.AccountId == account.Id) >= 10) return Error("Ya tienes 10 llaves registradas.");
        var options = await handler.MakeCreationOptionsAsync(new PasskeyUserEntity
        { Id = account.Id.ToString(), Name = account.Email, DisplayName = account.Name }, context);
        return await SaveFlow(account, "registro:" + Current(context.User), options.AttestationState, options.CreationOptionsJson, db);
    }

    private static async Task<IResult> Register(KeyInput input, HttpContext context, CrmDb db, IPasskeyHandler<Account> handler)
    {
        if (!Supported(context) || !Text(input.Name, 80, true) || !ValidCredential(input.Credential)) return Error("Revisa la llave y su nombre.");
        var account = (await db.Accounts.FindAsync(context.User.UserId()))!;
        var flow = await ConsumeFlow(input.Flow, account, "registro:" + Current(context.User), db);
        if (flow is null) return Conflict("La solicitud venció. Inicia el registro de nuevo.");
        var result = await handler.PerformAttestationAsync(new PasskeyAttestationContext
        { HttpContext = context, CredentialJson = input.Credential.GetRawText(), AttestationState = flow.State });
        if (!result.Succeeded || result.UserEntity?.Id != account.Id.ToString() || result.Passkey is not { } key)
            return Error("La llave no se pudo validar.");
        db.BumiPasskeys.Add(new BumiPasskey { AccountId = account.Id, Credential = key.CredentialId,
            Name = Clean(input.Name), Data = JsonSerializer.Serialize(key) });
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        { return Conflict("La llave ya está registrada."); }
        return Results.NoContent();
    }

    private static async Task<IResult> DeleteKey(int id, HttpContext context, CrmDb db)
    {
        var count = await db.BumiPasskeys.Where(x => x.Id == id && x.AccountId == context.User.UserId()).ExecuteDeleteAsync();
        return count == 0 ? Results.NotFound() : Results.NoContent();
    }

    private static async Task<IResult> RequestOptions(HttpContext context, CrmDb db, IPasskeyHandler<Account> handler)
    {
        if (!Supported(context)) return Error("Abre BUMI mediante HTTPS o localhost para usar una llave.");
        var pending = await AuthEndpoints.GetChallenge(context, db);
        if (pending is not { Factor.Confirmed: true, Challenge.PendingSecret: null } || !await db.BumiPasskeys.AnyAsync(x => x.AccountId == pending.Value.Account.Id))
            return Error("No hay llaves disponibles para esta verificación.");
        var (login, account, _) = pending.Value;
        var options = await handler.MakeRequestOptionsAsync(account, context);
        return await SaveFlow(account, "verificacion:" + login.Id, options.AssertionState, options.RequestOptionsJson, db);
    }

    private static async Task<IResult> Verify(KeyInput input, HttpContext context, CrmDb db, IPasskeyHandler<Account> handler)
    {
        if (!Supported(context) || !ValidCredential(input.Credential)) return Error("Revisa la llave.");
        var pending = await AuthEndpoints.GetChallenge(context, db);
        if (pending is not { Factor.Confirmed: true, Challenge.PendingSecret: null }) return Error("Inicia sesión nuevamente.");
        var (login, account, _) = pending.Value;
        var flow = await ConsumeFlow(input.Flow, account, "verificacion:" + login.Id, db);
        if (flow is null) return Conflict("La solicitud venció. Intenta de nuevo.");
        var result = await handler.PerformAssertionAsync(new PasskeyAssertionContext
        { HttpContext = context, CredentialJson = input.Credential.GetRawText(), AssertionState = flow.State });
        if (!result.Succeeded || result.User?.Id != account.Id || result.Passkey is not { } key)
        {
            login.Attempts++;
            await db.SaveChangesAsync();
            return Error("No se pudo verificar la llave.");
        }
        var stored = await db.BumiPasskeys.SingleOrDefaultAsync(x => x.AccountId == account.Id && x.Credential == key.CredentialId);
        if (stored is null) return Conflict("La llave se eliminó durante la verificación.");
        var original = JsonSerializer.Deserialize<UserPasskeyInfo>(stored.Data)!;
        if (original.SignCount > 0 && key.SignCount <= original.SignCount) return Conflict("La llave ya fue utilizada. Solicita otra verificación.");
        stored.Data = JsonSerializer.Serialize(key);
        db.LoginChallenges.Remove(login);
        var session = Create(context, account, db);
        await db.SaveChangesAsync();
        var principal = await SignIn(context, account, session);
        AuthEndpoints.DropChallenge(context);
        return Results.Ok(new { profile = await AuthEndpoints.GetProfile(principal, db) });
    }

    private static bool ValidCredential(JsonElement credential) =>
        credential.ValueKind == JsonValueKind.Object && credential.GetRawText().Length <= 64_000;

    private static async Task<IResult> SaveFlow(Account account, string kind, string? state, string options, CrmDb db)
    {
        if (string.IsNullOrEmpty(state)) return Error("No se pudo preparar la verificación de la llave.");
        var now = DateTimeOffset.UtcNow;
        await db.PasskeyFlows.Where(x => x.Expires <= now).ExecuteDeleteAsync();
        var flow = new PasskeyFlow { AccountId = account.Id, Version = account.SessionVersion, Kind = kind, State = state };
        db.PasskeyFlows.Add(flow);
        await db.SaveChangesAsync();
        return Results.Ok(new { flow = flow.Id, options = JsonSerializer.Deserialize<JsonElement>(options) });
    }

    private static async Task<PasskeyFlow?> ConsumeFlow(Guid id, Account account, string kind, CrmDb db)
    {
        var query = db.PasskeyFlows.Where(x => x.Id == id && x.AccountId == account.Id && x.Version == account.SessionVersion &&
            x.Kind == kind && x.Expires > DateTimeOffset.UtcNow);
        var flow = await query.AsNoTracking().SingleOrDefaultAsync();
        return flow is not null && await query.ExecuteDeleteAsync() == 1 ? flow : null;
    }

    private sealed record SetupInput(string? Password);
    private sealed record KeyInput(Guid Flow, string? Name, JsonElement Credential);
}

internal sealed class PasskeyStore(CrmDb db) : IUserStore<Account>, IUserPasskeyStore<Account>
{
    public Task<Account?> FindByIdAsync(string id, CancellationToken token) =>
        int.TryParse(id, out var key) ? db.Accounts.SingleOrDefaultAsync(x => x.Id == key && x.Active, token) : Task.FromResult<Account?>(null);
    public Task<Account?> FindByNameAsync(string name, CancellationToken token) =>
        db.Accounts.SingleOrDefaultAsync(x => x.Email == name.ToLowerInvariant() && x.Active, token);
    public Task<string> GetUserIdAsync(Account user, CancellationToken token) => Task.FromResult(user.Id.ToString());
    public Task<string?> GetUserNameAsync(Account user, CancellationToken token) => Task.FromResult<string?>(user.Email);
    public Task<string?> GetNormalizedUserNameAsync(Account user, CancellationToken token) => Task.FromResult<string?>(user.Email.ToUpperInvariant());
    public async Task<IList<UserPasskeyInfo>> GetPasskeysAsync(Account user, CancellationToken token) =>
        (await db.BumiPasskeys.Where(x => x.AccountId == user.Id).Select(x => x.Data).ToListAsync(token))
            .Select(data => JsonSerializer.Deserialize<UserPasskeyInfo>(data)!).ToList();
    public async Task<Account?> FindByPasskeyIdAsync(byte[] credentialId, CancellationToken token) =>
        await (from key in db.BumiPasskeys join user in db.Accounts on key.AccountId equals user.Id
            where key.Credential == credentialId && user.Active select user).SingleOrDefaultAsync(token);
    public async Task<UserPasskeyInfo?> FindPasskeyAsync(Account user, byte[] credentialId, CancellationToken token)
    {
        var data = await db.BumiPasskeys.Where(x => x.AccountId == user.Id && x.Credential == credentialId)
            .Select(x => x.Data).SingleOrDefaultAsync(token);
        return data is null ? null : JsonSerializer.Deserialize<UserPasskeyInfo>(data);
    }

    // The application endpoints manage writes in the same transaction as their authorization state.
    public Task AddOrUpdatePasskeyAsync(Account user, UserPasskeyInfo key, CancellationToken token) => throw new NotSupportedException();
    public Task RemovePasskeyAsync(Account user, byte[] key, CancellationToken token) => throw new NotSupportedException();
    public Task SetUserNameAsync(Account user, string? name, CancellationToken token) => throw new NotSupportedException();
    public Task SetNormalizedUserNameAsync(Account user, string? name, CancellationToken token) => throw new NotSupportedException();
    public Task<IdentityResult> CreateAsync(Account user, CancellationToken token) => throw new NotSupportedException();
    public Task<IdentityResult> UpdateAsync(Account user, CancellationToken token) => throw new NotSupportedException();
    public Task<IdentityResult> DeleteAsync(Account user, CancellationToken token) => throw new NotSupportedException();
    public void Dispose() { }
}
