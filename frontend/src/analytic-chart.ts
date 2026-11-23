import { Component, computed, input, signal } from '@angular/core';
import { currency } from './api';

export interface ChartPoint {
  key: string;
  label: string;
  value: number;
  low?: number;
  high?: number;
  baseline?: number;
  note?: string;
}

@Component({
  selector: 'bumi-analytic-chart',
  styleUrl: './analytic-chart.css',
  template: `
    <div class="chart-scroll" tabindex="0" [attr.aria-label]="caption()">
      <div class="chart-layout" [style.min-width.px]="80 + plot().length * 44">
        <div class="chart-axis" aria-hidden="true">
          @for (tick of ticks(); track tick) { <span>{{ axisLabel(tick) }}</span> }
        </div>
        <div class="chart-plot">
          @if (line()) {
            <svg viewBox="0 0 1000 240" preserveAspectRatio="none" aria-hidden="true">
              <polygon [attr.points]="band()" class="forecast-band" />
              <polyline [attr.points]="actualLine()" class="actual-line" vector-effect="non-scaling-stroke" />
              <polyline [attr.points]="projectionLine()" class="projection-line" vector-effect="non-scaling-stroke" />
            </svg>
          }
          @for (point of plot(); track point.key; let index = $index) {
            <div class="chart-lane" [class.active]="activeIndex() === index">
              <button type="button" class="chart-target" [attr.aria-label]="description(point)"
                (pointerenter)="hover.set(index)" (pointerleave)="hover.set(-1)"
                (focus)="focused.set(index)" (blur)="focused.set(-1)" (click)="pinned.set(pinned() === index ? -1 : index)"
                [attr.aria-pressed]="pinned() === index">
                @if (line()) {
                  <span class="chart-dot" [class.projected]="point.low !== undefined" [style.bottom.%]="height(point.value)" aria-hidden="true"></span>
                } @else {
                  @if (point.baseline !== undefined) {<span class="chart-bar comparison" [style.height.%]="height(point.baseline)" aria-hidden="true"></span>}
                  <span class="chart-bar" [style.height.%]="height(point.value)" aria-hidden="true"></span>
                }
              </button>
              <small>{{point.label}}</small>
            </div>
          }
          @if (activePoint(); as point) {
            <div class="chart-tooltip" aria-hidden="true" [style.left.%]="tooltipPosition()">
              <strong>{{point.label}}</strong><span>{{valueLabel(point)}}</span>
              @if (point.low !== undefined && point.high !== undefined) {<span>Rango {{format(point.low)}} a {{format(point.high)}}</span>}
              @if (point.baseline !== undefined) {<span>Pronóstico {{format(point.baseline)}}</span>}
              @if (point.note) {<span>{{point.note}}</span>}
            </div>
          }
        </div>
      </div>
    </div>
  `
})
export class AnalyticChart {
  readonly plot = input.required<ChartPoint[]>();
  readonly caption = input.required<string>();
  readonly money = input(true);
  readonly line = input(false);
  readonly focused = signal(-1);
  readonly hover = signal(-1);
  readonly pinned = signal(-1);
  readonly activeIndex = computed(() => this.hover() >= 0 ? this.hover() : this.focused() >= 0 ? this.focused() : this.pinned());
  readonly activePoint = computed(() => this.plot()[this.activeIndex()]);
  readonly tooltipPosition = computed(() => Math.max(19, Math.min(81, this.x(this.activeIndex()) / 10)));
  private readonly number = new Intl.NumberFormat('es-MX');
  private readonly compact = new Intl.NumberFormat('es-MX', {notation:'compact', maximumFractionDigits:1});
  private readonly ceiling = computed(() => {
    const peak = Math.max(1, ...this.plot().map(point => Math.max(point.high ?? point.value, point.baseline ?? 0)));
    const step = peak * 1.08 / 4;
    const magnitude = 10 ** Math.floor(Math.log10(step));
    const rounded = [1, 2, 2.5, 5, 10].find(n => n * magnitude >= step) ?? 10;
    return this.money() ? 4 * rounded * magnitude : 4 * Math.ceil(rounded * magnitude);
  });
  readonly ticks = computed(() => [4, 3, 2, 1, 0].map(n => this.ceiling() * n / 4));
  readonly actualLine = computed(() => this.plot().flatMap((point, index) =>
    point.low === undefined ? [this.coordinate(index, point.value)] : []).join(' '));
  private readonly forecastStart = computed(() => this.plot().findIndex(point => point.low !== undefined));
  readonly projectionLine = computed(() => {
    const start = this.forecastStart();
    return start < 0 ? '' : this.plot().slice(Math.max(0, start - 1)).map((point, index) =>
      this.coordinate(index + Math.max(0, start - 1), point.value)).join(' ');
  });
  readonly band = computed(() => {
    const start = this.forecastStart();
    if (start < 0) return '';
    const forecast = this.plot().slice(start);
    const upper = forecast.map((point, index) => this.coordinate(start + index, point.high ?? point.value));
    const lower = forecast.map((point, index) => this.coordinate(start + index, point.low ?? point.value)).reverse();
    const anchor = this.plot()[start - 1];
    return [...(anchor ? [this.coordinate(start - 1, anchor.value)] : []), ...upper, ...lower].join(' ');
  });

  format(value: number) { return (this.money() ? currency : this.number).format(value); }
  axisLabel(value: number) { return (this.money() ? '$' : '') + this.compact.format(value); }
  valueLabel(point: ChartPoint) {
    return (point.low !== undefined ? 'Estimación · ' : point.baseline !== undefined ? 'Real · ' : '') + this.format(point.value);
  }
  description(point: ChartPoint) {
    return [point.label, this.valueLabel(point), point.note,
      point.low !== undefined && point.high !== undefined ? 'rango de ' + this.format(point.low) + ' a ' + this.format(point.high) : '',
      point.baseline !== undefined ? 'pronóstico ' + this.format(point.baseline) : ''].filter(Boolean).join(', ');
  }
  height(value: number) { return value / this.ceiling() * 100; }
  private x(index: number) { return (index + .5) * 1000 / this.plot().length; }
  private coordinate(index: number, value: number) { return this.x(index) + ',' + (240 - this.height(value) * 2.4); }
}
