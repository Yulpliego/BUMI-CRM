namespace NexoCrm;

public sealed class Product
{
    public int Id { get; set; }
    public string Sku { get; set; } = "";
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public string Category { get; set; } = "";
    public string Unit { get; set; } = "Pieza";
    public decimal Price { get; set; }
    public int Stock { get; set; }
    public int Minimum { get; set; }
    public bool Active { get; set; } = true;
    public Guid Revision { get; set; } = Guid.NewGuid();
}

public sealed class Supplier
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Rfc { get; set; } = "";
    public string Contact { get; set; } = "";
    public string Phone { get; set; } = "";
    public string Email { get; set; } = "";
    public string Address { get; set; } = "";
    public bool Active { get; set; } = true;
    public Guid Revision { get; set; } = Guid.NewGuid();
}

public sealed class SupplierItem
{
    public int SupplierId { get; set; }
    public int ProductId { get; set; }
}

public sealed class StockEntry
{
    public int Id { get; set; }
    public int ProductId { get; set; }
    public int? SaleId { get; set; }
    public Sale? Sale { get; set; }
    public string Type { get; set; } = "";
    public string Reason { get; set; } = "";
    public int Delta { get; set; }
    public int Balance { get; set; }
    public string Actor { get; set; } = "";
    public DateTimeOffset At { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class AgendaItem
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public string Type { get; set; } = "";
    public string Status { get; set; } = "Pendiente";
    public DateTimeOffset Due { get; set; }
    public int OwnerId { get; set; }
    public int? PartyId { get; set; }
    public int? OpportunityId { get; set; }
    public int? QuoteId { get; set; }
    public Guid Revision { get; set; } = Guid.NewGuid();
}

public sealed class HistoryEntry
{
    public int Id { get; set; }
    public int PartyId { get; set; }
    public Party Party { get; set; } = null!;
    public string Type { get; set; } = "";
    public string Description { get; set; } = "";
    public string Actor { get; set; } = "";
    public DateTimeOffset At { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class NoticeReceipt
{
    public int AccountId { get; set; }
    public string Key { get; set; } = "";
    public DateTimeOffset ReadAt { get; set; } = DateTimeOffset.UtcNow;
    public string Group { get; set; } = "";
    public int? AcknowledgementSeconds { get; set; }
}
