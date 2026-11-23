import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ReportTools, Validation, Variation } from './report-tools';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api, currency, dateText, errorText } from './api';
import { AnalyticChart } from './analytic-chart';

interface Month { label: string; total: number; count: number; month: string; }
interface Projection { label: string; estimate: number; low: number; high: number; }
interface Forecast { model: string | null; months: number; through: string | null; meanError: number | null; forecast: Projection[]; reason: string | null; }
interface Stats {
  clients: number; leads: number; quoteCount: number; accepted: number; salesCount: number; revenue: number;
  start: string; end: string; months: Month[]; forecast: Forecast;
  owners: {id: number; name: string}[]; stages: {stage: string; count: number}[];
  products: {name: string; quantity: number}[]; byOwner: {name: string; total: number}[];
  byStatus: {status: string; count: number}[]; validation: Validation[]; variation: Variation | null;
}

@Component({
  imports: [FormsModule, RouterLink, ReportTools, AnalyticChart],
  templateUrl: './stats.html',
  styleUrl: './stats.css',
})
export class DashboardPage {
  api = inject(Api);
  money = currency;
  date = dateText;
  number = new Intl.NumberFormat('es-MX');
  signed = new Intl.NumberFormat('es-MX', { signDisplay: 'exceptZero' });
  percentage = new Intl.NumberFormat('es-MX', { style: 'percent', maximumFractionDigits: 1 });
  stats = signal<Stats | null>(null);
  message = signal('');
  busy = signal(false);
  metric = signal<'total' | 'count'>('total');
  horizon = signal(3);
  scenario = signal(0);
  hoverStatus = signal('');
  focusStatus = signal('');
  pinnedStatus = signal('');
  rankActive = signal('');
  private readonly route = inject(ActivatedRoute);
  readonly analyst = signal(this.route.snapshot.data['analyst'] === true || this.route.snapshot.queryParamMap.get('panel') === 'ia');
  applied = '';
  periodQuery: Record<string, string> = {};
  start = this.route.snapshot.queryParamMap.get('desde') ?? '';
  end = this.route.snapshot.queryParamMap.get('hasta') ?? '';
  status = this.route.snapshot.queryParamMap.get('estado') ?? '';
  owner = this.route.snapshot.queryParamMap.get('responsable') ?? '';
  statuses = ['Registrada', 'En proceso', 'Completada', 'Cancelada'];
  stages = ['Nueva', 'En seguimiento', 'Propuesta', 'Negociación', 'Ganada', 'Perdida'];

  readonly salesChart = computed(() => (this.stats()?.months ?? []).map(month => ({
    key: month.month, label: month.label, value: month[this.metric()],
    note: this.metric() === 'total' ? month.count + ' operaciones' : this.money.format(month.total) + ' en ventas',
  })));

  private readonly projections = computed(() => (this.stats()?.forecast.forecast ?? []).slice(0, this.horizon()).map(point => ({
    key: 'forecast-' + point.label, label: point.label, value: this.adjust(point.estimate),
    low: this.adjust(point.low), high: this.adjust(point.high),
  })));

  readonly projection = computed(() => {
    const data = this.stats();
    const through = data?.forecast.through;
    if (!data || !through) return [];
    const actual = data.months.filter(month => month.month >= data.start && month.month <= through).slice(-12);
    return [...actual.map(month => ({key: month.month, label: month.label, value: month.total, note: 'Venta registrada'})), ...this.projections()];
  });

  readonly scenarioTotals = computed(() => this.projections().reduce((sum, point) => ({
    value: sum.value + point.value, low: sum.low + point.low, high: sum.high + point.high,
  }), {value: 0, low: 0, high: 0}));

  readonly validationChart = computed(() => (this.stats()?.validation ?? []).map(row => ({
    key: row.label, label: row.label, value: row.actual, baseline: row.expected, note: 'Error ' + this.money.format(row.error),
  })));

  readonly segments = computed(() => {
    const data = this.stats();
    if (!data?.salesCount) return [];
    const colors: Record<string, string> = {Registrada: '#557b9a', 'En proceso': '#103554', Completada: '#08788b', Cancelada: '#a47435'};
    let offset = 0;
    return data.byStatus.filter(item => item.count > 0).map(item => {
      const share = this.ratio(item.count, data.salesCount);
      const segment = {label: item.status, value: item.count, color: colors[item.status] ?? '#567783', share, offset};
      offset += share;
      return segment;
    });
  });
  readonly activeSegment = computed(() => this.segments().find(item =>
    item.label === (this.hoverStatus() || this.focusStatus() || this.pinnedStatus())));

  readonly rankings = computed(() => {
    const data = this.stats();
    if (!data) return [];
    const scale = (value: number, max: number) => this.ratio(value, max);
    const ownerPeak = Math.max(1, ...data.byOwner.map(item => item.total));
    const productPeak = Math.max(1, ...data.products.map(item => item.quantity));
    const stagePeak = Math.max(1, ...data.stages.map(item => item.count));
    const stageTotal = data.stages.reduce((sum, item) => sum + item.count, 0);
    const portfolioTotal = data.clients + data.leads;
    return [
      {title: 'Ventas por responsable', subtitle: 'Importe en MXN según el filtro', empty: 'Sin ventas en el periodo.',
        items: data.byOwner.map(item => ({label: item.name, display: this.money.format(item.total), width: scale(item.total, ownerPeak),
          detail: this.money.format(item.total) + ' · ' + this.percent(item.total, data.revenue) + ' del total de ventas'}))},
      {title: 'Productos más vendidos', subtitle: 'Productos con más unidades vendidas', empty: 'Sin productos vendidos en el periodo.',
        items: data.products.map(item => ({label: item.name, display: this.number.format(item.quantity), width: scale(item.quantity, productPeak),
          detail: this.number.format(item.quantity) + ' unidades vendidas'}))},
      {title: 'Oportunidades por etapa', subtitle: 'Distribución actual de las oportunidades', empty: 'Sin oportunidades en la cartera activa.',
        items: stageTotal > 0 ? this.stages.map(label => {
          const count = this.stageCount(label, data);
          return {label, display: this.number.format(count), width: scale(count, stagePeak),
            detail: count + ' oportunidades · ' + this.percent(count, stageTotal) + ' del total'};
        }) : []},
      {title: 'Composición de la cartera activa', subtitle: 'Clientes y prospectos activos actualmente', empty: 'Sin clientes ni prospectos activos.',
        items: portfolioTotal ? [{label: 'Clientes', count: data.clients}, {label: 'Prospectos', count: data.leads}].map(item => ({
          label: item.label, display: this.number.format(item.count), width: scale(item.count, portfolioTotal),
          detail: this.number.format(item.count) + ' registros · ' + this.percent(item.count, portfolioTotal) + ' de la cartera',
        })) : []},
    ];
  });

  pinStatus(label: string) { this.pinnedStatus.update(current => current === label ? '' : label); }
  pinRank(group: string, label: string) { this.rankActive.update(current => current === group + label ? '' : group + label); }
  ngOnInit() { void this.load(); }

  async load() {
    if (this.busy()) return;
    this.busy.set(true);
    this.message.set('');
    const params = new URLSearchParams();
    if (this.start) params.set('desde', this.start);
    if (this.end) params.set('hasta', this.end);
    if (this.status) params.set('estado', this.status);
    if (this.owner) params.set('responsable', this.owner);
    try {
      const data = await this.api.get<Stats>('estadisticas?' + params);
      params.set('desde', data.start);
      params.set('hasta', data.end);
      this.applied = params.toString();
      const query: Record<string, string> = {};
      params.forEach((value, key) => query[key] = value);
      this.periodQuery = query;
      this.hoverStatus.set('');
      this.focusStatus.set('');
      this.pinnedStatus.set('');
      this.rankActive.set('');
      this.stats.set(data);
      if (!this.start) this.start = data.start;
      if (!this.end) this.end = data.end;
    } catch (error) { this.message.set(errorText(error)); }
    finally { this.busy.set(false); }
  }

  exportCsv() {
    const data = this.stats();
    if (!data) return;
    const rows: (string | number)[][] = [
      ['Informe comercial BUMI', data.start, data.end],
      ['Indicador', 'Valor'],
      ['Ventas', data.salesCount], ['Importe de ventas MXN', data.revenue],
      ['Clientes activos', data.clients], ['Prospectos activos', data.leads],
      ['Cotizaciones', data.quoteCount], ['Cotizaciones aceptadas', data.accepted],
      [], ['Mes', 'Ventas MXN', 'Operaciones'], ...data.months.map(item => [item.label, item.total, item.count]),
      [], ['Etapa', 'Oportunidades'], ...this.stages.map(stage => [stage, this.stageCount(stage, data)]),
      [], ['Responsable', 'Ventas MXN'], ...data.byOwner.map(item => [item.name, item.total]),
      [], ['Producto', 'Unidades'], ...data.products.map(item => [item.name, item.quantity]),
    ];
    const escape = (value: string | number) => {
      if (typeof value === 'number') return String(value);
      const safe = /^[\s]*[=+@-]/.test(value) ? "'" + value : value;
      return '"' + safe.replace(/"/g, '""') + '"';
    };
    const content = '\uFEFF' + rows.map(values => values.map(escape).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([content], {type: 'text/csv;charset=utf-8'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'BUMI-estadisticas-' + data.start + '-' + data.end + '.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  percent(value: number, max: number) { return this.percentage.format(this.ratio(value, max) / 100); }
  ratio(value: number, max: number) { return max > 0 ? 100 * value / max : 0; }
  adjust(value: number) { return value * (1 + this.scenario() / 100); }
  stageCount(stage: string, stats: Stats) { return stats.stages.find(x => x.stage === stage)?.count || 0; }
}
