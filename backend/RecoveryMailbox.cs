using System.Net.Mail;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using static NexoCrm.CrmRules;

namespace NexoCrm;

internal static class RecoveryMailbox
{
    private const int Attempts = 5;

    public static void Map(WebApplication app)
    {
        var mailbox = app.MapGroup("/api/auth/recovery/mailbox").RequireAuthorization();
        mailbox.MapGet("", Get);
        mailbox.MapPost("", Begin).RequireRateLimiting("password-mail");
        mailbox.MapPost("/confirm", Confirm).RequireRateLimiting("password-reset");
        mailbox.MapPost("/quitar", Remove).RequireRateLimiting("password-mail");
    }

    public static Task Apply(CrmDb db) => db.Database.ExecuteSqlRawAsync("""
        CREATE TABLE IF NOT EXISTS "RecoveryMailboxes" (
            "AccountId" integer PRIMARY KEY REFERENCES "Accounts" ("Id") ON DELETE CASCADE,
            "Email" text NOT NULL DEFAULT '', "PendingEmail" text NOT NULL DEFAULT '',
            "Hash" text NOT NULL DEFAULT '', "Version" uuid NOT NULL,
            "RequestedAt" timestamptz NOT NULL, "ExpiresAt" timestamptz NOT NULL, "Attempts" integer NOT NULL
        );
        CREATE TABLE IF NOT EXISTS "RecoveryDestinations" (
            "AccountId" integer NOT NULL REFERENCES "Accounts" ("Id") ON DELETE CASCADE,
            "Email" text NOT NULL, "VerifiedAt" timestamptz NOT NULL,
            PRIMARY KEY ("AccountId","Email")
        );
        WITH legacy AS (
            SELECT "AccountId","Email" FROM "RecoveryMailboxes" WHERE "Email"<>''
        )
        INSERT INTO "RecoveryDestinations" ("AccountId","Email","VerifiedAt")
        SELECT "AccountId","Email",NOW() FROM legacy ON CONFLICT DO NOTHING;
        UPDATE "RecoveryMailboxes" SET "Email"='' WHERE "Email"<>'';
        """);

    internal static bool IsDeliverable(string address) => MailAddress.TryCreate(address, out var parsed) &&
        parsed.Address == address && !parsed.Host.EndsWith(".test", StringComparison.OrdinalIgnoreCase) &&
        !parsed.Host.EndsWith(".invalid", StringComparison.OrdinalIgnoreCase) &&
        !parsed.Host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase);

    internal static Task Lock(CrmDb db, int accountId) =>
        db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(186117,{accountId})");

    private static async Task<IResult> Get(ClaimsPrincipal user, CrmDb db, PasswordMail mail)
    {
        var account = (await db.Accounts.FindAsync(user.UserId()))!;
        var row = await db.Database.SqlQuery<MailboxStatus>($"""
            SELECT "Email","PendingEmail","Version","ExpiresAt","Attempts"
            FROM "RecoveryMailboxes" WHERE "AccountId"={account.Id}
            """).SingleOrDefaultAsync();
        var pending = row is not null && row.Version == account.SessionVersion &&
            row.ExpiresAt > DateTimeOffset.UtcNow && row.Attempts < Attempts ? row.PendingEmail : "";
        var emails = await db.Database.SqlQuery<string>($"""
            SELECT "Email" AS "Value" FROM "RecoveryDestinations" WHERE "AccountId"={account.Id}
            ORDER BY "VerifiedAt","Email"
            """).ToListAsync();
        return Results.Ok(new { loginEmail = account.Email, email = emails.FirstOrDefault() ?? "", emails,
            pending, available = mail.Available, demo = mail.Pickup });
    }

    private static async Task<IResult> Begin(BindInput input, ClaimsPrincipal user, CrmDb db, PasswordMail mail,
        IPasswordHasher<Account> hasher, ILogger<PasswordMail> logger, CancellationToken cancellation)
    {
        var email = Clean(input.Email).ToLowerInvariant();
        if (!Text(email,160,true) || !(mail.Pickup ? Email(email) : IsDeliverable(email)))
            return Error("Ingresa un correo que pueda recibir los mensajes de BUMI.");
        if (!mail.Available) return Results.Json(new { message = "El servicio de correo aún no está configurado." }, statusCode:503);
        var account = (await db.Accounts.FindAsync(user.UserId()))!;
        if (!AuthEndpoints.MatchesPassword(input.Password, account, hasher))
            return Error("La contraseña actual es incorrecta.");
        var addresses = await db.Database.SqlQuery<string>($"""
            SELECT "Email" AS "Value" FROM "RecoveryDestinations" WHERE "AccountId"={account.Id}
            """).ToListAsync(cancellation);
        if (addresses.Contains(email)) return Conflict("Ese correo ya está verificado.");
        if (addresses.Count >= 4) return Conflict("Puedes vincular hasta cuatro correos de recuperación.");
        var code = Convert.ToHexString(RandomNumberGenerator.GetBytes(6));
        var hash = PasswordRecovery.Hash(code);
        var now = DateTimeOffset.UtcNow;
        var minutes = now.AddMinutes(15);
        var reserved = await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "RecoveryMailboxes" ("AccountId","PendingEmail","Hash","Version","RequestedAt","ExpiresAt","Attempts")
            VALUES ({account.Id},{email},{hash},{account.SessionVersion},{now},{minutes},0)
            ON CONFLICT ("AccountId") DO UPDATE SET "PendingEmail"=EXCLUDED."PendingEmail","Hash"=EXCLUDED."Hash",
                "Version"=EXCLUDED."Version","RequestedAt"=EXCLUDED."RequestedAt","ExpiresAt"=EXCLUDED."ExpiresAt","Attempts"=0
            WHERE "RecoveryMailboxes"."RequestedAt" <= {now.AddMinutes(-1)}
            """, cancellation);
        if (reserved != 1) return Conflict("Espera un minuto antes de solicitar otro código.");
        try { await mail.SendMailboxCode(email, code, cancellation); }
        catch (Exception failure) when (!cancellation.IsCancellationRequested)
        {
            logger.LogWarning("Falló el envío de verificación de correo ({Category}).", failure.GetType().Name);
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE "RecoveryMailboxes" SET "ExpiresAt"={now},"RequestedAt"={now.AddMinutes(-1)}
                WHERE "AccountId"={account.Id} AND "Hash"={hash}
                """, cancellation);
            return Results.Json(new { message = "El proveedor de correo rechazó el envío o no respondió. Revisa la configuración de Gmail." },
                statusCode:503);
        }
        return Results.NoContent();
    }

    private static async Task<IResult> Confirm(CodeInput input, ClaimsPrincipal user, CrmDb db)
    {
        var code = Clean(input.Code).ToUpperInvariant();
        if (code.Length != 12 || code.Any(c => !char.IsAsciiHexDigit(c))) return Error("Revisa el código de 12 caracteres.");
        var account = (await db.Accounts.FindAsync(user.UserId()))!;
        var now = DateTimeOffset.UtcNow;
        var hash = PasswordRecovery.Hash(code);
        await using var tx = await db.Database.BeginTransactionAsync();
        await Lock(db, account.Id);
        var reserved = await db.Database.ExecuteSqlInterpolatedAsync($"""
            WITH verified AS (
                UPDATE "RecoveryMailboxes"
                SET "Email"="PendingEmail","PendingEmail"='',"Hash"='',"ExpiresAt"={now}
                WHERE "AccountId"={account.Id} AND "Version"={account.SessionVersion} AND "Hash"={hash}
                    AND "ExpiresAt">{now} AND "Attempts"<{Attempts} AND "PendingEmail"<>''
                    AND (SELECT COUNT(*) FROM "RecoveryDestinations" WHERE "AccountId"={account.Id}) < 4
                RETURNING "AccountId","Email"
            )
            INSERT INTO "RecoveryDestinations" ("AccountId","Email","VerifiedAt")
                SELECT "AccountId","Email",{now} FROM verified
                ON CONFLICT ("AccountId","Email") DO UPDATE SET "VerifiedAt"="RecoveryDestinations"."VerifiedAt"
            """);
        if (reserved == 1)
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE "RecoveryMailboxes" SET "Email"='' WHERE "AccountId"={account.Id}
                """);
        if (reserved == 0)
        {
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE "RecoveryMailboxes" SET "Attempts"="Attempts"+1
                WHERE "AccountId"={account.Id} AND "Version"={account.SessionVersion}
                    AND "ExpiresAt">{now} AND "Attempts"<{Attempts}
                """);
        }
        else
        {
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE "PasswordResetLinks" SET "ExpiresAt"={now} WHERE "AccountId"={account.Id} AND "ExpiresAt">{now}
                """);
        }
        await tx.CommitAsync();
        return reserved == 1 ? Results.NoContent() : Error("El código es incorrecto, venció o ya se usó.");
    }

    private static async Task<IResult> Remove(BindInput input, ClaimsPrincipal user, CrmDb db, IPasswordHasher<Account> hasher)
    {
        var account = (await db.Accounts.FindAsync(user.UserId()))!;
        if (!AuthEndpoints.MatchesPassword(input.Password, account, hasher)) return Error("La contraseña actual es incorrecta.");
        var email = Clean(input.Email).ToLowerInvariant();
        await using var tx = await db.Database.BeginTransactionAsync();
        await Lock(db, account.Id);
        var removed = await db.Database.ExecuteSqlInterpolatedAsync($"""
            DELETE FROM "RecoveryDestinations" WHERE "AccountId"={account.Id} AND "Email"={email}
            """);
        if (removed != 1) return Results.NotFound();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE "PasswordResetLinks" SET "ExpiresAt"={DateTimeOffset.UtcNow} WHERE "AccountId"={account.Id}
            """);
        await tx.CommitAsync();
        return Results.NoContent();
    }

    private sealed record MailboxStatus(string Email, string PendingEmail, Guid Version, DateTimeOffset ExpiresAt, int Attempts);
    private sealed record BindInput(string? Email, string? Password);
    private sealed record CodeInput(string? Code);
}
