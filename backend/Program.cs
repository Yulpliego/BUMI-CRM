using Microsoft.AspNetCore.StaticFiles;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using NexoCrm;
using System.Security.Claims;

var builder = WebApplication.CreateBuilder(args);
var connection = builder.Configuration.GetConnectionString("Crm")
    ?? throw new InvalidOperationException("Configura ConnectionStrings__Crm antes de iniciar.");
if (builder.Configuration["CrmKeysPath"] is { } keyPath)
    builder.Services.AddDataProtection().PersistKeysToFileSystem(new DirectoryInfo(keyPath)).SetApplicationName("NexoCrm");
builder.Services.AddDbContext<CrmDb>(options => options.UseNpgsql(connection));
builder.Services.AddScoped<IPasswordHasher<Account>, PasswordHasher<Account>>();
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "NexoCrm.Session";
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
            if (account is null || !account.Active || account.SessionVersion.ToString() != user.FindFirstValue("version"))
                context.RejectPrincipal();
        };
    });
builder.Services.AddAuthorization();
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = 429;
    options.AddPolicy("login", context => System.Threading.RateLimiting.RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "local",
        _ => new System.Threading.RateLimiting.FixedWindowRateLimiterOptions
        {
            PermitLimit = 12, Window = TimeSpan.FromMinutes(1), QueueLimit = 0
        }));
});

var app = builder.Build();
app.Use(async (context, next) =>
{
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
RelationshipEndpoints.Map(app);
MarketingEndpoints.Map(app);
CommerceEndpoints.Map(app);
StatisticsEndpoints.Map(app);
app.Map("/api/{**rest}", () => Results.NotFound());
app.MapFallbackToFile("index.html");

await using (var scope = app.Services.CreateAsyncScope())
{
    var db = scope.ServiceProvider.GetRequiredService<CrmDb>();
    await db.Database.EnsureCreatedAsync();
    await Seed.Initialize(db, scope.ServiceProvider.GetRequiredService<IPasswordHasher<Account>>(), app.Configuration);
}
await app.RunAsync();
