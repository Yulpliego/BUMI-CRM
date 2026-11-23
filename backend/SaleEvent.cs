namespace NexoCrm;

public sealed class SaleEvent
{
    public int Id { get; set; }
    public int SaleId { get; set; }
    public Sale Sale { get; set; } = null!;
    public DateTimeOffset At { get; set; } = DateTimeOffset.UtcNow;
    public string Actor { get; set; } = "";
    public string Status { get; set; } = "";
    public string Description { get; set; } = "";
}
