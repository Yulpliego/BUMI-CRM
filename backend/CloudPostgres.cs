using Npgsql;

namespace NexoCrm;

internal static class CloudPostgres
{
    internal static string ConnectionString(string value)
    {
        var components = Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri)
            ? uri.UserInfo.Split(':', 2) : [];
        var database = uri?.AbsolutePath.TrimStart('/');
        if (uri is null || uri.Scheme is not ("postgres" or "postgresql") || uri.Host.Length == 0 ||
            components.Length != 2 || components.Any(string.IsNullOrEmpty) || string.IsNullOrEmpty(database) ||
            database.Contains('/') || uri.Fragment.Length != 0)
            throw new InvalidOperationException("BumiCloud__PostgresUrl requiere la URL directa de PostgreSQL.");

        return new NpgsqlConnectionStringBuilder
        {
            Host = uri.IdnHost,
            Port = uri.IsDefaultPort ? 5432 : uri.Port,
            Database = Uri.UnescapeDataString(database),
            Username = Uri.UnescapeDataString(components[0]),
            Password = Uri.UnescapeDataString(components[1]),
            SslMode = SslMode.VerifyFull,
            MaxPoolSize = 20
        }.ConnectionString;
    }
}
