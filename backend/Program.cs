using Microsoft.AspNetCore.StaticFiles;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using NexoCrm;
using System.Security.Claims;

var builder = WebApplication.CreateBuilder(args);
var connection = builder.Configuration.GetConnectionString("Crm")
    ?? (builder.Configuration["BumiCloud:PostgresUrl"] is { Length: > 0 } cloudUrl
        ? CloudPostgres.ConnectionString(cloudUrl)
        : null)
    ?? throw new InvalidOperationException("Configura ConnectionStrings__Crm o BumiCloud__PostgresUrl antes de iniciar.");
builder.Services.AddDbContext<CrmDb>(options => options.UseNpgsql(connection));
var persistCloudKeys = builder.Configuration.GetValue<bool>("BumiCloud:PersistKeys");
if (persistCloudKeys)
    builder.Services.AddDataProtection().PersistKeysToDbContext<CrmDb>().SetApplicationName("BUMI-Cloud");
else if (builder.Configuration["CrmKeysPath"] is { } keyPath)
    builder.Services.AddDataProtection().PersistKeysToFileSystem(new DirectoryInfo(keyPath)).SetApplicationName("NexoCrm");
builder.Services.AddIdentityCore<Account>().AddUserStore<PasskeyStore>();
builder.Services.AddScoped<IPasskeyHandler<Account>, PasskeyHandler<Account>>();
builder.Services.Configure<IdentityPasskeyOptions>(options => options.UserVerificationRequirement = "required");
builder.Services.AddScoped<Authenticator>();
builder.Services.AddSingleton<PasswordMail>();
builder.Services.AddSingleton<PasswordMailQueue>();
builder.Services.AddHostedService(services => services.GetRequiredService<PasswordMailQueue>());
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "Bumi.Session";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Strict;
        options.Cookie.SecurePolicy = builder.Environment.IsDevelopment()
            ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
        options.ExpireTimeSpan = TimeSpan.FromHours(8);
        options.SlidingExpiration = false;
        options.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = 401; return Task.CompletedTask; };
        options.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = 403; return Task.CompletedTask; };
        options.Events.OnValidatePrincipal = async context =>
        {
            var user = context.Principal!;
            var db = context.HttpContext.RequestServices.GetRequiredService<CrmDb>();
            var account = await db.Accounts.AsNoTracking().SingleOrDefaultAsync(x => x.Id == user.UserId());
            if (account is null || !account.Active || !user.HasClaim("amr", "mfa") ||
                account.SessionVersion.ToString() != user.FindFirstValue("version") ||
                SessionAccess.Current(user) is not Guid sessionId ||
                !await db.AccountSessions.AnyAsync(x => x.Id == sessionId && x.AccountId == account.Id &&
                    x.Version == account.SessionVersion && !x.Revoked && x.Expires > DateTimeOffset.UtcNow))
                context.RejectPrincipal();
        };
    });
builder.Services.AddAuthorization();
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = 429;
    foreach (var (name, limit) in new[] { ("login", 12), ("verify", 30), ("password-mail", 6), ("password-reset", 15), ("password-backup", 15), ("authenticator-management", 8) })
        options.AddPolicy(name, context => System.Threading.RateLimiting.RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "local",
            _ => new System.Threading.RateLimiting.FixedWindowRateLimiterOptions
            {
                PermitLimit = limit, Window = TimeSpan.FromMinutes(1), QueueLimit = 0
            }));
});

var app = builder.Build();
app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/restablecer"))
    {
        context.Response.Headers["Referrer-Policy"] = "no-referrer";
        context.Response.Headers.CacheControl = "no-store";
    }
    if (context.Request.Path.StartsWithSegments("/api"))
    {
        context.Response.Headers.CacheControl = "no-store";
        if (context.Request.Method is not ("GET" or "HEAD" or "OPTIONS") &&
            context.Request.Headers["X-Nexo-Request"] != "1")
        {
            await CrmRules.Error("Solicitud inválida.").ExecuteAsync(context);
            return;
        }
    }
    try { await next(); }
    catch (DbUpdateConcurrencyException) when (!context.Response.HasStarted)
    {
        await CrmRules.Conflict("El registro cambió. Recarga la página e inténtalo de nuevo.").ExecuteAsync(context);
    }
});
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.UseDefaultFiles();
var staticTypes = new FileExtensionContentTypeProvider();
staticTypes.Mappings[".webmanifest"] = "application/manifest+json";
app.UseStaticFiles(new StaticFileOptions
{
    ContentTypeProvider = staticTypes,
    OnPrepareResponse = context =>
    {
        if (context.File.Name is "index.html" or "sw.js")
            context.Context.Response.Headers.CacheControl = "no-cache";
    }
});

app.MapGet("/api/health", async (CrmDb db) => await db.Database.CanConnectAsync()
    ? Results.Ok(new { database = "PostgreSQL" }) : Results.StatusCode(503));
AuthEndpoints.Map(app);
PasswordRecovery.Map(app);
RecoveryMailbox.Map(app);
SessionAccess.Map(app);
RelationshipEndpoints.Map(app);
MarketingEndpoints.Map(app);
CommerceEndpoints.Map(app);
StatisticsEndpoints.Map(app);
WorkEndpoints.Map(app);
StockEndpoints.Map(app);
ForecastEndpoints.Map(app);
GrowthEndpoints.Map(app);
CommerceImprovements.Map(app);
SupplyImprovements.Map(app);
WorkImprovements.Map(app);
app.Map("/api/{**rest}", () => Results.NotFound());
app.MapFallbackToFile("index.html");

await using (var scope = app.Services.CreateAsyncScope())
{
    var db = scope.ServiceProvider.GetRequiredService<CrmDb>();
    await db.Database.EnsureCreatedAsync();
    if (persistCloudKeys)
        await db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS "DataProtectionKeys" (
                "Id" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                "FriendlyName" text NULL,
                "Xml" text NULL
            );
            """);
    await SchemaUpgrade.Apply(db);
    await ImprovementSchema.Apply(db);
    await PasswordRecovery.Apply(db);
    await RecoveryMailbox.Apply(db);
    var hasher = scope.ServiceProvider.GetRequiredService<IPasswordHasher<Account>>();
    await Seed.Initialize(db, hasher, app.Configuration);
    await OperationsSeed.Initialize(db, hasher, app.Configuration);
    if (app.Configuration.GetValue<bool>("BumiDemo:Enabled"))
    {
        await DemoDataset.Load(db, app.Logger);
        await ImprovementDemo.Load(db);
    }
}
await app.RunAsync();
