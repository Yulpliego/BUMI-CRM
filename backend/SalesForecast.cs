using System.Globalization;

namespace NexoCrm;

internal sealed record MonthlySales(string Label, decimal Total, int Count, DateOnly Month);

internal static class SalesForecast
{
    internal sealed record Point(string Label, decimal Estimate, decimal Low, decimal High);
    internal sealed record Result(string? Model, int Months, DateOnly? Through, decimal? MeanError, Point[] Forecast, string? Reason);

    public static Result Train(IReadOnlyList<MonthlySales> series, DateOnly start, DateOnly end, DateOnly today, CultureInfo culture)
    {
        var currentMonth = new DateOnly(today.Year, today.Month, 1);
        var full = series.Where(x => x.Month >= start && x.Month < currentMonth &&
            x.Month.AddMonths(1).AddDays(-1) <= end).ToArray();
        var last = full.LastOrDefault()?.Month;
        if (full.Length < 6 || full.Count(x => x.Count > 0) < 4)
            return new(null, full.Length, last, null, [], "Selecciona al menos seis meses completos y cuatro meses con ventas para entrenar el modelo.");

        var values = full.Select(x => (double)x.Total).ToArray();
        var trendErrors = new List<double>();
        var meanErrors = new List<double>();
        for (var test = 4; test < values.Length; test++)
        {
            var training = values.AsSpan(0, test);
            var trend = Fit(training);
            trendErrors.Add(Math.Abs(values[test] - Predict(trend, test)));
            meanErrors.Add(Math.Abs(values[test] - RecentMean(training)));
        }

        var useTrend = trendErrors.Average() < meanErrors.Average();
        var error = (useTrend ? trendErrors : meanErrors).Average();
        var fitted = Fit(values);
        var average = RecentMean(values);
        var through = last!.Value.AddMonths(1).AddDays(-1);
        var firstProjection = last.Value.AddMonths(1);
        if (firstProjection == currentMonth) firstProjection = firstProjection.AddMonths(1);

        var points = Enumerable.Range(0, 3).Select(i =>
        {
            var month = firstProjection.AddMonths(i);
            var steps = (month.Year - last.Value.Year) * 12 + month.Month - last.Value.Month;
            var estimate = useTrend ? Predict(fitted, values.Length - 1 + steps) : average;
            var range = error * Math.Sqrt(steps);
            return new Point(month.ToString("MMM yy", culture), Money(estimate),
                Money(Math.Max(0, estimate - range)), Money(estimate + range));
        }).ToArray();
        return new(useTrend ? "Tendencia lineal" : "Promedio móvil de 3 meses", full.Length, through, Money(error), points, null);
    }

    private static (double Intercept, double Slope) Fit(ReadOnlySpan<double> values)
    {
        var center = (values.Length - 1) / 2d;
        double total = 0, covariance = 0, variance = 0;
        for (var i = 0; i < values.Length; i++)
        {
            var distance = i - center;
            total += values[i];
            covariance += distance * values[i];
            variance += distance * distance;
        }
        var slope = covariance / variance;
        return (total / values.Length - slope * center, slope);
    }

    private static double RecentMean(ReadOnlySpan<double> values) => (values[^1] + values[^2] + values[^3]) / 3;
    private static double Predict((double Intercept, double Slope) model, int index) => Math.Max(0, model.Intercept + model.Slope * index);
    private static decimal Money(double value) => Math.Round((decimal)value, 2, MidpointRounding.AwayFromZero);
}
