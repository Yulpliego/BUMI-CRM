import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BumiIcon } from './icon';
import { Api, currency, dateText, errorText, folio } from './api';

interface Operation {
  id: number;
  module: 'ventas' | 'cotizaciones';
  party: string;
  owner: string;
  date: string;
  total: number;
  status: string;
}

interface Dashboard {
  start: string;
  end: string;
  salesTotal: number | null;
  previousTotal: number | null;
  activeQuotes: number | null;
  activeQuoteValue: number | null;
  newClients: number | null;
  previousNewClients: number | null;
  conversionRate: number | null;
  acceptedQuotes: number;
  resolvedQuotes: number;
  analyst: { openCount: number; dueSoon: number; suggestions: {
    id: number; party: string; description: string; stage: string; value: number;
    expectedClose: string | null; recommendation: string;
  }[] } | null;
  series: { from: string; through: string; total: number }[];
  operations: Operation[];
}

interface Workspace {
  pending: number;
  overdue: number;
  openValue: number;
  expiring: number;
  lowStock: number;
  tasks: { id: number; title: string; type: string; party: string | null; due: string }[];
  recent: { key: string; party: string; type: string; description: string; at: string }[];
}

const region = { timeZone: 'America/Mexico_City' };
const shortDate = new Intl.DateTimeFormat('es-MX', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const compact = new Intl.NumberFormat('es-MX', { notation: 'compact', maximumFractionDigits: 1 });
const dateLabel = new Intl.DateTimeFormat('es-MX', { dateStyle: 'full', ...region });
const percentage = new Intl.NumberFormat('es-MX', { style: 'percent', maximumFractionDigits: 1 });
const taskDate = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', ...region });
const signedPercent = new Intl.NumberFormat('es-MX', { style: 'percent', signDisplay: 'exceptZero', maximumFractionDigits: 1 });
const chartWidth = 760;
const chartTop = 14;
const chartBase = 208;

@Component({
  imports: [RouterLink, BumiIcon],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class HomePage implements OnInit {
  readonly api = inject(Api);
  readonly panel = signal<Dashboard | null>(null);
  readonly workspace = signal<Workspace | null>(null);
  readonly busy = signal(true);
  readonly message = signal('');
  readonly workspaceError = signal('');
  readonly days = signal(90);
  readonly query = signal('');
  readonly page = signal(1);
  readonly highlighted = signal(-1);
  readonly pageSize = 6;
  readonly today = dateLabel.format(new Date()).replace(/^./u, letter => letter.toLocaleUpperCase('es-MX'));
  readonly analystOpen = signal(false);
  readonly percent = (value: number) => percentage.format(value / 100);
  readonly money = currency;
  readonly date = dateText;
  readonly formatTask = (value: string) => taskDate.format(new Date(value));
  readonly short = (value: string) => shortDate.format(new Date(value + 'T00:00:00Z'));

  readonly filtered = computed(() => {
    const term = this.query().trim().toLocaleLowerCase('es-MX');
    return (this.panel()?.operations ?? []).filter(row =>
      [this.folio(row), row.party, row.owner, row.status, this.kind(row)]
        .some(value => value.toLocaleLowerCase('es-MX').includes(term)));
  });
  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.filtered().length / this.pageSize)));
  readonly visible = computed(() => this.filtered().slice((this.page() - 1) * this.pageSize, this.page() * this.pageSize));
  readonly salesChange = computed(() => {
    const state = this.panel();
    return state?.salesTotal != null && state.previousTotal
      ? (state.salesTotal - state.previousTotal) / state.previousTotal : null;
  });
  readonly changeLabel = computed(() => {
    const change = this.salesChange();
    return change === null ? '' : signedPercent.format(change);
  });
  readonly chart = computed(() => {
    const series = this.panel()?.series ?? [];
    const max = Math.max(0, ...series.map(item => item.total));
    const step = max > 0 ? 10 ** Math.floor(Math.log10(max / 4)) : 1;
    const ceiling = max > 0 ? Math.ceil(max / (4 * step)) * 4 * step : 4;
    const points = series.map((item, index) => ({
      ...item, x: (chartWidth / (series.length * 2)) * (index * 2 + 1),
      y: chartBase - item.total / ceiling * (chartBase - chartTop),
    }));
    const path = points.map((point, index) => (index ? 'L' : 'M') + point.x + ',' + point.y).join(' ');
    return {
      points, path, max,
      area: points.length ? path + ' L' + points.at(-1)?.x + ',' + chartBase + ' H' + points[0].x + ' Z' : '',
      ticks: [1, .75, .5, .25, 0].map(value => ({
        y: chartBase - (chartBase - chartTop) * value, label: '$' + compact.format(ceiling * value),
      })),
    };
  });
  readonly selected = computed(() => this.chart().points.at(this.highlighted()));

  ngOnInit() {
    void this.load(this.days());
    void this.loadWorkspace();
  }

  async load(days: number) {
    this.days.set(days);
    this.busy.set(true);
    this.message.set('');
    try {
      this.panel.set(await this.api.get<Dashboard>('inicio/panel?days=' + days));
      this.page.set(1);
      this.highlighted.set(-1);
    } catch (error) {
      this.message.set(errorText(error));
    } finally {
      this.busy.set(false);
    }
  }
  async loadWorkspace() {
    this.workspaceError.set('');
    try { this.workspace.set(await this.api.get<Workspace>('inicio?includeNotices=false')); }
    catch (error) { this.workspaceError.set(errorText(error)); }
  }

  readonly previousPage = (page: number) => Math.max(1, page - 1);
  readonly nextPage = (page: number) => Math.min(this.pageCount(), page + 1);

  search(value: string) {
    this.query.set(value);
    this.page.set(1);
  }

  folio(row: Operation) { return folio(row.module === 'ventas' ? 'VTA' : 'COT', row.id); }
  kind(row: Operation) { return row.module === 'ventas' ? 'Venta' : 'Cotización'; }
  initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase(); }

  exportOperations() {
    const rows = [['Folio', 'Tipo', 'Cliente', 'Responsable', 'Fecha', 'Importe MXN', 'Estado'],
      ...this.filtered().map(row => [this.folio(row), this.kind(row), row.party, row.owner, row.date, row.total, row.status])];
    const csv = rows.map(row => row.map(cell => {
      const text = typeof cell === 'string' && /^[\s]*[=+@-]/.test(cell) ? "'" + cell : String(cell);
      return '"' + text.replaceAll('"', '""') + '"';
    }).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'BUMI-operaciones-' + this.panel()?.end + '.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

