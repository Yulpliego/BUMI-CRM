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
    public DbSet<AccountFactor> AccountFactors => Set<AccountFactor>();
    public DbSet<LoginChallenge> LoginChallenges => Set<LoginChallenge>();
    public DbSet<RecoveryCode> RecoveryCodes => Set<RecoveryCode>();
    public DbSet<SaleEvent> SaleEvents => Set<SaleEvent>();
    public DbSet<Product> Products => Set<Product>();
    public DbSet<Supplier> Suppliers => Set<Supplier>();
    public DbSet<SupplierItem> SupplierItems => Set<SupplierItem>();
    public DbSet<StockEntry> StockEntries => Set<StockEntry>();
    public DbSet<AgendaItem> AgendaItems => Set<AgendaItem>();
    public DbSet<HistoryEntry> HistoryEntries => Set<HistoryEntry>();
    public DbSet<NoticeReceipt> NoticeReceipts => Set<NoticeReceipt>();
    public DbSet<CampaignOrigin> CampaignOrigins => Set<CampaignOrigin>();
    public DbSet<QuoteVersion> QuoteVersions => Set<QuoteVersion>();
    public DbSet<Fulfillment> Fulfillments => Set<Fulfillment>();
    public DbSet<SupplyTerm> SupplyTerms => Set<SupplyTerm>();
    public DbSet<PurchaseDraft> PurchaseDrafts => Set<PurchaseDraft>();
    public DbSet<AgendaChange> AgendaChanges => Set<AgendaChange>();
    public DbSet<NoticePreference> NoticePreferences => Set<NoticePreference>();
    public DbSet<AccountSession> AccountSessions => Set<AccountSession>();
    public DbSet<BumiPasskey> BumiPasskeys => Set<BumiPasskey>();
    public DbSet<PasskeyFlow> PasskeyFlows => Set<PasskeyFlow>();

    protected override void OnModelCreating(ModelBuilder model)
    {
        model.Entity<CampaignOrigin>().HasIndex(x => x.PartyId).IsUnique();
        model.Entity<QuoteVersion>().HasIndex(x => new { x.QuoteId, x.Revision }).IsUnique();
        model.Entity<Fulfillment>().HasIndex(x => new { x.SaleId, x.RequestId }).IsUnique();
        model.Entity<BumiPasskey>().HasIndex(x => x.Credential).IsUnique();
        model.Entity<BumiPasskey>().Property(x => x.Data).IsConcurrencyToken();
        model.Entity<PurchaseDraft>().Property(x => x.Status).IsConcurrencyToken();
        model.Entity<QuoteVersion>().Property(x => x.Approval).IsConcurrencyToken();
        model.Entity<Product>().HasIndex(x => x.Sku).IsUnique();
        model.Entity<Product>().Property(x => x.Revision).IsConcurrencyToken();
        model.Entity<Supplier>().Property(x => x.Revision).IsConcurrencyToken();
        model.Entity<SupplierItem>().HasKey(x => new { x.SupplierId, x.ProductId });
        model.Entity<SupplierItem>().HasOne<Supplier>().WithMany().HasForeignKey(x => x.SupplierId);
        model.Entity<SupplierItem>().HasOne<Product>().WithMany().HasForeignKey(x => x.ProductId);
        model.Entity<StockEntry>().HasOne(x => x.Sale).WithMany().HasForeignKey(x => x.SaleId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<StockEntry>().HasOne<Product>().WithMany().HasForeignKey(x => x.ProductId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<AgendaItem>().Property(x => x.Revision).IsConcurrencyToken();
        model.Entity<AgendaItem>().HasIndex(x => new { x.OwnerId, x.Due });
        model.Entity<HistoryEntry>().HasIndex(x => new { x.PartyId, x.At });
        model.Entity<HistoryEntry>().HasOne(x => x.Party).WithMany().HasForeignKey(x => x.PartyId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<NoticeReceipt>().HasKey(x => new { x.AccountId, x.Key });
        model.Entity<Account>().HasIndex(x => x.Email).IsUnique();
        model.Entity<Account>().Property(x => x.SessionVersion).IsConcurrencyToken();
        model.Entity<AccountFactor>().HasKey(x => x.AccountId);
        model.Entity<AccountFactor>().HasOne<Account>().WithOne().HasForeignKey<AccountFactor>(x => x.AccountId);
        model.Entity<AccountFactor>().Property(x => x.LastStep).IsConcurrencyToken();
        model.Entity<AccountFactor>().Property(x => x.Secret).IsConcurrencyToken();
        model.Entity<AccountFactor>().Property(x => x.AdditionalSecret).IsConcurrencyToken();
        model.Entity<AccountFactor>().Property(x => x.AdditionalLastStep).IsConcurrencyToken();
        model.Entity<LoginChallenge>().HasOne<Account>().WithMany().HasForeignKey(x => x.AccountId);
        model.Entity<LoginChallenge>().HasIndex(x => x.ExpiresAt);
        model.Entity<LoginChallenge>().Property(x => x.Attempts).IsConcurrencyToken();
        model.Entity<LoginChallenge>().Property(x => x.PendingSecret).IsConcurrencyToken();
        model.Entity<RecoveryCode>().HasKey(x => new { x.AccountId, x.Hash });
        model.Entity<RecoveryCode>().HasIndex(x => x.Hash);
        model.Entity<RecoveryCode>().HasOne<Account>().WithMany().HasForeignKey(x => x.AccountId);
        model.Entity<SaleEvent>().HasOne(x => x.Sale).WithMany().HasForeignKey(x => x.SaleId);
        model.Entity<Sale>().HasIndex(x => x.QuoteId).IsUnique();
        model.Entity<Quote>().HasOne<Party>().WithMany().HasForeignKey(x => x.PartyId);
        model.Entity<Quote>().OwnsMany(x => x.Lines, line =>
            line.HasOne<Product>().WithMany().HasForeignKey(x => x.ProductId).OnDelete(DeleteBehavior.Restrict));
        model.Entity<Opportunity>().Property(x => x.Revision).IsConcurrencyToken();
        model.Entity<Sale>().HasOne(x => x.Document).WithOne().HasForeignKey<Sale>(x => x.QuoteId);
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
    public DateTimeOffset? DeletedAt { get; set; }
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
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public Guid Revision { get; set; } = Guid.NewGuid();
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
    public bool IsDirectSale { get; set; }
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
    public int? ProductId { get; set; }
    public string Product { get; set; } = "";
    public int Quantity { get; set; }
    public decimal Price { get; set; }
    public decimal Discount { get; set; }
}

public sealed class Sale
{
    public int Id { get; set; }
    public int QuoteId { get; set; }
    public Quote Document { get; set; } = null!;
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
