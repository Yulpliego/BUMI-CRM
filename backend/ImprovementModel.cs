using Microsoft.EntityFrameworkCore;

namespace NexoCrm;

[PrimaryKey(nameof(CampaignId), nameof(PartyId))]
public sealed class CampaignOrigin
{
    public int CampaignId { get; set; }
    public int PartyId { get; set; }
    public DateOnly CapturedOn { get; set; }
    public string Source { get; set; } = "";
    public string Segment { get; set; } = "";
    public decimal Cost { get; set; }
}

public sealed class QuoteVersion
{
    public int Id { get; set; }
    public int QuoteId { get; set; }
    public Guid Revision { get; set; }
    public DateTimeOffset At { get; set; } = DateTimeOffset.UtcNow;
    public string Actor { get; set; } = "";
    public string Snapshot { get; set; } = "";
    public decimal Total { get; set; }
    public decimal MaxDiscount { get; set; }
    public string Approval { get; set; } = "No requerida";
    public string DecisionBy { get; set; } = "";
    public string DecisionReason { get; set; } = "";
    public DateTimeOffset? DecidedAt { get; set; }
}

public sealed class Fulfillment
{
    public int Id { get; set; }
    public int SaleId { get; set; }
    public int Position { get; set; }
    public int Quantity { get; set; }
    public string Kind { get; set; } = "";
    public string Reason { get; set; } = "";
    public DateOnly EffectiveOn { get; set; }
    public DateOnly? PromisedOn { get; set; }
    public string Actor { get; set; } = "";
    public Guid RequestId { get; set; }
}

[PrimaryKey(nameof(SupplierId), nameof(ProductId))]
public sealed class SupplyTerm
{
    public int SupplierId { get; set; }
    public int ProductId { get; set; }
    public decimal Cost { get; set; }
    public int LeadDays { get; set; }
}

public sealed class PurchaseDraft
{
    public int Id { get; set; }
    public int SupplierId { get; set; }
    public int ProductId { get; set; }
    public int Quantity { get; set; }
    public decimal UnitCost { get; set; }
    public DateOnly Due { get; set; }
    public DateOnly? Received { get; set; }
    public string Status { get; set; } = "Borrador";
    public string Actor { get; set; } = "";
}

public sealed class AgendaChange
{
    public int Id { get; set; }
    public int AgendaId { get; set; }
    public int OwnerId { get; set; }
    public DateTimeOffset Due { get; set; }
    public DateTimeOffset At { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? NewDue { get; set; }
    public string Kind { get; set; } = "";
    public string Reason { get; set; } = "";
    public string Actor { get; set; } = "";
}

[PrimaryKey(nameof(AccountId))]
public sealed class NoticePreference
{
    public int AccountId { get; set; }
    public int QuietFrom { get; set; } = 22;
    public int QuietUntil { get; set; } = 7;
    public int EscalationHours { get; set; } = 48;
    public string Priority { get; set; } = "Actividades";
}

public sealed class AccountSession
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public int AccountId { get; set; }
    public Guid Version { get; set; }
    public DateTimeOffset Started { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset Expires { get; set; } = DateTimeOffset.UtcNow.AddHours(8);
    public string Device { get; set; } = "";
    public bool Revoked { get; set; }
}

public sealed class BumiPasskey
{
    public int Id { get; set; }
    public int AccountId { get; set; }
    public byte[] Credential { get; set; } = [];
    public string Data { get; set; } = "";
    public string Name { get; set; } = "";
    public DateTimeOffset Added { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class PasskeyFlow
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public int AccountId { get; set; }
    public Guid Version { get; set; }
    public string Kind { get; set; } = "";
    public string State { get; set; } = "";
    public DateTimeOffset Expires { get; set; } = DateTimeOffset.UtcNow.AddMinutes(3);
}
