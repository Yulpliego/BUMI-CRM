using System.Net;
using System.Net.Mail;
using System.Security.Cryptography;
using System.Threading.Channels;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.WebUtilities;
using static NexoCrm.CrmRules;

namespace NexoCrm;

internal sealed class PasswordMail(IConfiguration config, IHostEnvironment host)
{
    private IConfigurationSection Settings => config.GetSection("RecoveryMail");
    public bool Pickup => host.IsDevelopment() && !string.IsNullOrWhiteSpace(Settings["PickupDirectory"]);
    private string Sender => Settings["From"] ?? (Pickup ? "acceso@bumi.test" : "");
    private Uri? Origin
    {
        get
        {
            if (!Uri.TryCreate(Settings["PublicOrigin"], UriKind.Absolute, out var uri) ||
                uri.UserInfo.Length != 0 || uri.AbsolutePath != "/" || uri.Query.Length != 0 || uri.Fragment.Length != 0 ||
                (uri.Scheme != "https" && !(host.IsDevelopment() && uri.IsLoopback && uri.Scheme == "http")))
                return null;
            return uri;
        }
    }
    public bool Available => Origin is not null && MailAddress.TryCreate(Sender, out _) &&
        (Pickup || !string.IsNullOrWhiteSpace(Settings["Host"]));

    public async Task Send(string recipient, string token, string code, CancellationToken cancellation)
    {
        var link = new Uri(Origin!, "/restablecer#token=" + token);
        await SendMessage(recipient, $"BUMI · Recuperación de contraseña ({DateTimeOffset.UtcNow:HH:mm} UTC)",
            "Recibimos una solicitud para restablecer tu contraseña de BUMI.\r\n\r\n" +
            "Abre el enlace o introduce el código en la pantalla de recuperación. Ambos caducan en 15 minutos.\r\n\r\n" +
            link.AbsoluteUri + "\r\n\r\nCódigo de recuperación:\r\n" + code +
            "\r\n\r\nSi no hiciste la solicitud, puedes ignorar este mensaje.", cancellation);
    }

    public Task SendMailboxCode(string recipient, string code, CancellationToken cancellation) =>
        SendMessage(recipient, "Verifica tu correo de recuperación de BUMI",
            "Ingresa este código en Mi cuenta de BUMI en los próximos 15 minutos.\r\n\r\n" +
            code + "\r\n\r\nSi no solicitaste vincular esta dirección, ignora este mensaje.", cancellation);

    private async Task SendMessage(string recipient, string subject, string body, CancellationToken cancellation)
    {
        using var message = new MailMessage(new MailAddress(Sender, "BUMI"), new MailAddress(recipient))
        {
            Subject = subject,
            Body = body
        };
        using var smtp = new SmtpClient();
        if (Pickup)
        {
            var outbox = Path.GetFullPath(Settings["PickupDirectory"]!);
            Directory.CreateDirectory(outbox);
            smtp.DeliveryMethod = SmtpDeliveryMethod.SpecifiedPickupDirectory;
            smtp.PickupDirectoryLocation = outbox;
        }
        else
        {
            smtp.Host = Settings["Host"]!;
            smtp.Port = Settings.GetValue("Port", 587);
            smtp.EnableSsl = true;
            if (Settings["Username"] is { Length: > 0 } user)
                smtp.Credentials = new NetworkCredential(user, Settings["Password"]);
        }
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        timeout.CancelAfter(TimeSpan.FromSeconds(20));
        await smtp.SendMailAsync(message, timeout.Token);
    }
}

internal sealed class PasswordMailQueue(IServiceScopeFactory scopes, PasswordMail mail, ILogger<PasswordMailQueue> logger) : BackgroundService
{
    private readonly Channel<(string Email, string? Recipient)> pending =
        Channel.CreateBounded<(string, string?)>(new BoundedChannelOptions(100) { SingleReader = true });
    public bool Queue(string email, string? recipient) => pending.Writer.TryWrite((email, recipient));

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var (email, recipient) in pending.Reader.ReadAllAsync(stoppingToken))
        {
            try { await Process(email, recipient, stoppingToken); }
            catch (Exception ex) when (!stoppingToken.IsCancellationRequested)
            {
                // SMTP exceptions can contain a recipient. Record only the failure category.
                logger.LogWarning("No se completó un envío de recuperación ({Category}).", ex.GetType().Name);
            }
        }
    }

    private async Task Process(string email, string? requestedRecipient, CancellationToken cancellation)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CrmDb>();
        var account = await db.Accounts.AsNoTracking().FirstOrDefaultAsync(x => x.Active && x.Email == email, cancellation);
        if (account is null) return;
        await using var tx = await db.Database.BeginTransactionAsync(cancellation);
        await RecoveryMailbox.Lock(db, account.Id);
        var destinations = await db.Database.SqlQuery<string>($"""
            SELECT "Email" AS "Value" FROM "RecoveryDestinations" WHERE "AccountId"={account.Id}
            ORDER BY "VerifiedAt","Email"
            """).ToListAsync(cancellation);
        if (requestedRecipient is not null && !destinations.Contains(requestedRecipient)) return;
        var recipient = requestedRecipient ?? destinations.FirstOrDefault();
        if (recipient is null) return;
        if (!mail.Pickup && !RecoveryMailbox.IsDeliverable(recipient)) return;
        var now = DateTimeOffset.UtcNow;
        var token = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        var hash = PasswordRecovery.Hash(token);
        var code = Convert.ToHexString(RandomNumberGenerator.GetBytes(6));
        var codeHash = PasswordRecovery.Hash(code);
        var updated = await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "PasswordResetLinks" ("AccountId","Hash","CodeHash","Version","RequestedAt","ExpiresAt")
            VALUES ({account.Id},{hash},{codeHash},{account.SessionVersion},{now},{now.AddMinutes(15)})
            ON CONFLICT ("AccountId") DO UPDATE SET "Hash"=EXCLUDED."Hash","CodeHash"=EXCLUDED."CodeHash","Version"=EXCLUDED."Version",
                "RequestedAt"=EXCLUDED."RequestedAt","ExpiresAt"=EXCLUDED."ExpiresAt"
            WHERE "PasswordResetLinks"."ExpiresAt" <= {now}
                OR "PasswordResetLinks"."RequestedAt" <= {now.AddMinutes(-2)}
            """, cancellation);
        if (updated == 0) return;
        await tx.CommitAsync(cancellation);
        try { await mail.Send(recipient, token, code, cancellation); }
        catch
        {
            // A provider outage must not block the next legitimate attempt.
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE "PasswordResetLinks" SET "ExpiresAt"={now}, "RequestedAt"={now.AddMinutes(-2)}
                WHERE "AccountId"={account.Id} AND "Hash"={hash}
                """, CancellationToken.None);
            throw;
        }
    }
}

internal static class PasswordRecovery
{
    public static void Map(WebApplication app)
    {
        var auth = app.MapGroup("/api/auth/recovery");
        auth.MapPost("/email", Request).RequireRateLimiting("password-mail");
        auth.MapPost("/reset", Reset).RequireRateLimiting("password-reset");
    }

    public static Task Apply(CrmDb db) => db.Database.ExecuteSqlRawAsync("""
        CREATE TABLE IF NOT EXISTS "PasswordResetLinks" (
            "AccountId" integer PRIMARY KEY REFERENCES "Accounts" ("Id") ON DELETE CASCADE,
            "Hash" text NOT NULL UNIQUE, "Version" uuid NOT NULL,
            "RequestedAt" timestamptz NOT NULL, "ExpiresAt" timestamptz NOT NULL
        );
        ALTER TABLE "PasswordResetLinks" ADD COLUMN IF NOT EXISTS "CodeHash" text;
        """);

    public static string Hash(string token) => Convert.ToHexString(SHA256.HashData(System.Text.Encoding.ASCII.GetBytes(token)));

    private static IResult Request(EmailRequest input, PasswordMail mail, PasswordMailQueue queue)
    {
        var email = Clean(input.Email).ToLowerInvariant();
        if (!Text(email, 160, true) || !Email(email)) return Error("Ingresa un correo electrónico válido.");
        var recipient = Clean(input.Recipient).ToLowerInvariant();
        if (recipient.Length > 0 && (!Text(recipient,160) || !Email(recipient)))
            return Error("Ingresa un correo de destino válido.");
        if (!mail.Available || !queue.Queue(email, recipient.Length == 0 ? null : recipient))
            return Results.Json(new { message = "El servicio de correo no está disponible en este momento." }, statusCode: 503);
        return Results.Json(new { demo = mail.Pickup }, statusCode: 202);
    }

    private static async Task<IResult> Reset(ResetRequest input, HttpContext context, CrmDb db, IPasswordHasher<Account> hasher)
    {
        if (!AuthEndpoints.ValidNewPassword(input.Password))
            return Error("Usa una contraseña nueva de 12 a 128 caracteres.");
        var viaCode = string.IsNullOrEmpty(input.Token);
        var email = Clean(input.Email).ToLowerInvariant();
        var value = viaCode ? Clean(input.Code).ToUpperInvariant() : input.Token!;
        if (viaCode ? !Text(email,160,true) || !Email(email) || value.Length != 12 || value.Any(c => !char.IsAsciiHexDigit(c)) :
            value.Length != 43 || value.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not ('-' or '_')))
            return Invalid();
        await using var tx = await db.Database.BeginTransactionAsync();
        var now = DateTimeOffset.UtcNow;
        var digest = Hash(value);
        var accountIds = viaCode
            ? await db.Database.SqlQuery<int>($"""
                SELECT r."AccountId" AS "Value" FROM "PasswordResetLinks" r JOIN "Accounts" a ON a."Id"=r."AccountId"
                WHERE a."Email"={email} AND r."CodeHash"={digest} AND r."ExpiresAt">{now}
                """).ToListAsync()
            : await db.Database.SqlQuery<int>($"""
                SELECT "AccountId" AS "Value" FROM "PasswordResetLinks" WHERE "Hash"={digest} AND "ExpiresAt">{now}
                """).ToListAsync();
        if (accountIds.Count != 1) return Invalid();
        var account = await db.Accounts.FindAsync(accountIds[0]);
        if (account is not { Active: true }) return Invalid();
        var claimed = await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE "PasswordResetLinks" SET "ExpiresAt"={now}
            WHERE (CASE WHEN {viaCode} THEN "CodeHash" ELSE "Hash" END)={digest}
                AND "AccountId"={account.Id} AND "Version"={account.SessionVersion} AND "ExpiresAt">{now}
            """);
        if (claimed != 1) return Invalid();
        AuthEndpoints.SetPassword(account, input.Password!, hasher);
        await db.SaveChangesAsync();
        await tx.CommitAsync();
        await context.SignOutAsync();
        AuthEndpoints.DropChallenge(context);
        return Results.NoContent();
    }

    private static IResult Invalid() => Error("El enlace o código venció, se usó o ya no es válido. Solicita uno nuevo.");
    private sealed record EmailRequest(string? Email, string? Recipient);
    private sealed record ResetRequest(string? Token, string? Password, string? Email, string? Code);
}
