using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using QRCoder;

namespace NexoCrm;

public sealed class AccountFactor
{
    public int AccountId { get; set; }
    public string Secret { get; set; } = "";
    public long LastStep { get; set; } = -1;
    public bool Confirmed { get; set; }
    public string? AdditionalSecret { get; set; }
    public long AdditionalLastStep { get; set; } = -1;
}

public sealed class LoginChallenge
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public int AccountId { get; set; }
    public Guid SessionVersion { get; set; }
    public string? PendingSecret { get; set; }
    public bool Replacement { get; set; }
    public bool AddPhone { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public int Attempts { get; set; }
}

public sealed class RecoveryCode
{
    public int AccountId { get; set; }
    public string Hash { get; set; } = "";
}

public sealed class Authenticator(IDataProtectionProvider protection)
{
    private const string Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    private readonly IDataProtector protector = protection.CreateProtector("BUMI.Authenticator.v1");

    public string Protect(byte[] secret) => protector.Protect(Convert.ToBase64String(secret));

    public object CreateSetup(string email, string secret)
    {
        var key = Base32(Unprotect(secret));
        var uri = $"otpauth://totp/BUMI:{Uri.EscapeDataString(email)}?secret={key}&issuer=BUMI&digits=6&period=30";
        using var qrData = QRCodeGenerator.GenerateQrCode(uri, QRCodeGenerator.ECCLevel.M);
        using var qr = new PngByteQRCode(qrData);
        return new { key, qr = Convert.ToBase64String(qr.GetGraphic(5)) };
    }

    public long? Verify(string secret, string? code, long lastStep)
    {
        if (code is not { Length: 6 } || code.Any(value => !char.IsAsciiDigit(value))) return null;
        var key = Unprotect(secret);
        var step = DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 30;
        var candidate = Encoding.ASCII.GetBytes(code);
        Span<byte> counter = stackalloc byte[8];
        for (var offset = 0; offset < 3; offset++)
        {
            var current = step + (offset == 2 ? 1 : -offset);
            if (current <= lastStep) continue;
            BinaryPrimitives.WriteInt64BigEndian(counter, current);
            var hash = HMACSHA1.HashData(key, counter);
            var position = hash[^1] & 0xf;
            var otp = (BinaryPrimitives.ReadInt32BigEndian(hash.AsSpan(position, 4)) & int.MaxValue) % 1_000_000;
            if (CryptographicOperations.FixedTimeEquals(candidate, Encoding.ASCII.GetBytes(otp.ToString("D6"))))
                return current;
        }
        return null;
    }

    public static string[] AddRecoveryCodes(int accountId, CrmDb db)
    {
        var codes = new string[8];
        for (var i = 0; i < codes.Length; i++)
        {
            var raw = Convert.ToHexString(RandomNumberGenerator.GetBytes(12));
            codes[i] = string.Join("-", Enumerable.Range(0, 4).Select(index => raw.Substring(6 * index, 6)));
            db.RecoveryCodes.Add(new RecoveryCode { AccountId = accountId, Hash = Digest(raw) });
        }
        return codes;
    }

    public static async Task<RecoveryCode?> FindRecovery(int accountId, string? code, CrmDb db)
    {
        var hash = RecoveryDigest(code);
        return hash is null ? null : await db.RecoveryCodes.FindAsync(accountId, hash);
    }

    internal static string? RecoveryDigest(string? code)
    {
        if (code is not { Length: >= 24 and <= 36 }) return null;
        var value = code.Trim().Replace("-", "").ToUpperInvariant();
        return value.Length == 24 && value.All(char.IsAsciiHexDigit) ? Digest(value) : null;
    }

    private byte[] Unprotect(string secret) => Convert.FromBase64String(protector.Unprotect(secret));

    private static string Digest(string text) => Convert.ToHexString(SHA256.HashData(Encoding.ASCII.GetBytes(text)));

    private static string Base32(byte[] input)
    {
        var output = new StringBuilder();
        int buffer = 0, bits = 0;
        foreach (var value in input)
        {
            buffer = (buffer << 8) | value;
            bits += 8;
            while (bits >= 5)
            {
                bits -= 5;
                output.Append(Alphabet[(buffer >> bits) & 31]);
            }
        }
        if (bits > 0) output.Append(Alphabet[(buffer << (5 - bits)) & 31]);
        return output.ToString();
    }
}
