using Microsoft.EntityFrameworkCore;

namespace NexoCrm;

public sealed class CrmDb(DbContextOptions<CrmDb> options) : DbContext(options)
{
    public DbSet<Account> Accounts => Set<Account>();
    public DbSet<Party> Parties => Set<Party>();
    public DbSet<Contact> Contacts => Set<Contact>();
    public DbSet<Opportunity> Opportunities => Set<Opportunity>();
    public DbSet<Campaign> Campaigns => Set<Campaign>();
    public DbSet<Quote> Quotes => Set<Quote>();
    public DbSet<Sale> Sales => Set<Sale>();
    public DbSet<ModuleSetting> Modules => Set<ModuleSetting>();

    protected override void OnModelCreating(ModelBuilder model)
    {
        model.Entity<Account>().HasIndex(x => x.Email).IsUnique();
        model.Entity<Sale>().HasIndex(x => x.QuoteId).IsUnique();
        model.Entity<Quote>().HasOne<Party>().WithMany().HasForeignKey(x => x.PartyId);
        model.Entity<Quote>().OwnsMany(x => x.Lines);
        model.Entity<Sale>().HasOne<Quote>().WithOne().HasForeignKey<Sale>(x => x.QuoteId);
        model.Entity<Contact>().HasOne<Party>().WithMany().HasForeignKey(x => x.PartyId);
        model.Entity<Opportunity>().HasOne<Party>().WithMany().HasForeignKey(x => x.PartyId);
        model.Entity<Campaign>().HasMany(x => x.Audience).WithMany();
        model.Entity<ModuleSetting>().HasKey(x => x.Key);
        model.Entity<Party>().Property(x => x.Revision).IsConcurrencyToken();
        model.Entity<Campaign>().Property(x => x.Revision).IsConcurrencyToken();
        model.Entity<Quote>().Property(x => x.Revision).IsConcurrencyToken();
        model.Entity<Sale>().Property(x => x.Revision).IsConcurrencyToken();
    }
}

public sealed class Account
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
    public string Role { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public Guid SessionVersion { get; set; } = Guid.NewGuid();
    public bool Active { get; set; } = true;
}

public sealed class Party
{
    public int Id { get; set; }
    public string Kind { get; set; } = "Prospecto";
    public string Name { get; set; } = "";
    public string PersonType { get; set; } = "Empresa";
    public string Contact { get; set; } = "";
    public string Email { get; set; } = "";
    public string Phone { get; set; } = "";
    public string Source { get; set; } = "";
    public string Rfc { get; set; } = "";
    public string Industry { get; set; } = "";
    public string Address { get; set; } = "";
    public string Stage { get; set; } = "Nuevo";
    public bool Active { get; set; } = true;
    public int OwnerId { get; set; }
    public Guid Revision { get; set; } = Guid.NewGuid();
}

public sealed class Contact
{
    public int Id { get; set; }
    public int PartyId { get; set; }
    public string Name { get; set; } = "";
    public string Position { get; set; } = "";
    public string Email { get; set; } = "";
    public string Phone { get; set; } = "";
}

public sealed class Opportunity
{
    public int Id { get; set; }
    public int PartyId { get; set; }
    public string Description { get; set; } = "";
    public string Interest { get; set; } = "";
    public decimal Value { get; set; }
    public DateOnly? ExpectedClose { get; set; }
    public string Stage { get; set; } = "Nueva";
    public int OwnerId { get; set; }
}

public sealed class Campaign
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Goal { get; set; } = "";
    public string Description { get; set; } = "";
    public string Channel { get; set; } = "";
    public string Segment { get; set; } = "";
    public string Status { get; set; } = "Planeada";
    public DateOnly Start { get; set; }
    public DateOnly End { get; set; }
    public int Reached { get; set; }
    public int Leads { get; set; }
    public int OwnerId { get; set; }
    public List<Party> Audience { get; set; } = [];
    public Guid Revision { get; set; } = Guid.NewGuid();
}

public sealed class Quote
{
    public int Id { get; set; }
    public int PartyId { get; set; }
    public int OwnerId { get; set; }
    public DateOnly Date { get; set; } = CrmRules.Today();
    public DateOnly ValidUntil { get; set; }
    public string Status { get; set; } = "Borrador";
    public string Terms { get; set; } = "";
    public string Notes { get; set; } = "";
    public decimal TaxRate { get; set; } = 16;
    public List<QuoteLine> Lines { get; set; } = [];
    public decimal Subtotal { get; set; }
    public decimal Tax { get; set; }
    public decimal Total { get; set; }
    public Guid Revision { get; set; } = Guid.NewGuid();

    public void Calculate()
    {
        Subtotal = Lines.Sum(x => CrmRules.Round(x.Quantity * x.Price * (1 - x.Discount / 100)));
        Tax = CrmRules.Round(Subtotal * TaxRate / 100);
        Total = Subtotal + Tax;
    }
}

public sealed class QuoteLine
{
    public int Position { get; set; }
    public string Product { get; set; } = "";
    public int Quantity { get; set; }
    public decimal Price { get; set; }
    public decimal Discount { get; set; }
}

public sealed class Sale
{
    public int Id { get; set; }
    public int QuoteId { get; set; }
    public DateOnly Date { get; set; } = CrmRules.Today();
    public string Status { get; set; } = "Registrada";
    public string CancelReason { get; set; } = "";
    public string CancelledBy { get; set; } = "";
    public DateTimeOffset? CancelledAt { get; set; }
    public Guid Revision { get; set; } = Guid.NewGuid();
}

public sealed class ModuleSetting
{
    public string Key { get; set; } = "";
    public bool Enabled { get; set; } = true;
}
