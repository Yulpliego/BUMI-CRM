import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, currency, dateText, errorText } from './api';

interface Stats {
  clients: number; leads: number; quoteCount: number; accepted: number; salesCount: number; revenue: number;
  start: string; end: string; months: {label: string; total: number}[];
  owners: {id: number; name: string}[]; stages: {stage: string; count: number}[];
  products: {name: string; quantity: number}[]; byOwner: {name: string; total: number}[];
}

@Component({
  imports: [FormsModule],
  template: `
    <header class="page-head"><div><p class="eyebrow">VISIÓN COMERCIAL</p><h1>Estadísticas</h1><p>Consulta la actividad comercial y el desempeño de tus ventas.</p></div></header>
    <form class="filters panel" (ngSubmit)="load()">
      <label>Desde<input type="date" name="start" [(ngModel)]="start"></label>
      <label>Hasta<input type="date" name="end" [(ngModel)]="end"></label>
      <label>Estado de venta<select name="status" [(ngModel)]="status"><option value="">Ventas vigentes</option>@for (value of statuses; track value) {<option>{{value}}</option>}</select></label>
      @if (api.manager) {
        <label>Responsable<select name="owner" [(ngModel)]="owner"><option value="">Todo el equipo</option>
          @for (person of stats()?.owners; track person.id) { <option [value]="person.id">{{ person.name }}</option> }
        </select></label>
      }
      <button class="primary" [disabled]="busy()">Aplicar filtros</button>
    </form>
    @if (message()) { <p class="error" role="alert">{{message()}}</p> }
    @if (stats(); as s) {
      <section class="metrics" aria-label="Indicadores">
        <article class="panel metric"><span class="metric-icon green" aria-hidden="true">▥</span><p>Ventas del periodo</p><strong>{{ money.format(s.revenue) }}</strong><small>{{ s.salesCount }} operaciones · MXN</small></article>
        <article class="panel metric"><span class="metric-icon blue" aria-hidden="true">▤</span><p>Cotizaciones</p><strong>{{ s.quoteCount }}</strong><small>{{ s.accepted }} aceptadas</small></article>
        <article class="panel metric"><span class="metric-icon violet" aria-hidden="true">◎</span><p>Clientes activos</p><strong>{{ s.clients }}</strong><small>Cartera actual</small></article>
        <article class="panel metric"><span class="metric-icon gold" aria-hidden="true">◉</span><p>Prospectos activos</p><strong>{{ s.leads }}</strong><small>Seguimiento comercial</small></article>
      </section>
      <div class="dashboard-grid">
        <section class="panel padded trend">
          <header class="section-head"><div><h2>Ventas por mes</h2><p>{{ date(s.start) }} – {{ date(s.end) }}</p></div><span class="legend">Total en MXN</span></header>
          <div class="chart" role="list" aria-label="Importes mensuales de ventas">
            @for (month of s.months; track month.label) {
              <div class="plot-group" role="listitem">
                <div class="plot-track"><div class="plot-bar" [style.height.%]="bar(month.total, s)" [attr.title]="money.format(month.total)"></div></div>
                <strong>{{ compact.format(month.total) }}</strong><small>{{month.label}}</small>
              </div>
            }
          </div>
        </section>
        <section class="panel padded">
          <header class="section-head"><div><h2>Oportunidades</h2><p>Por etapa del proceso comercial</p></div></header>
          <div class="stage-list">
            @for (stage of stages; track stage) {
              <div><span>{{stage}}</span><span class="stage-track"><i [style.width.%]="stagePercent(stage, s)"></i></span><strong>{{stageCount(stage,s)}}</strong></div>
            }
          </div>
        </section>
        <section class="panel padded">
          <header class="section-head"><h2>Productos con mayor movimiento</h2></header>
          @for (product of s.products; track product.name) {
            <div class="report-row"><span>{{product.name}}</span><strong>{{product.quantity}} unidades</strong></div>
          } @empty { <p class="empty">Sin productos vendidos en este periodo.</p> }
        </section>
        <section class="panel padded">
          <header class="section-head"><h2>Ventas por responsable</h2></header>
          @for (person of s.byOwner; track person.name) {
            <div class="report-row"><span>{{person.name}}</span><strong>{{money.format(person.total)}}</strong></div>
          } @empty { <p class="empty">Sin ventas registradas en este periodo.</p> }
        </section>
      </div>
    } @else if (busy()) { <p class="empty" role="status">Cargando indicadores…</p> }
  `
})
export class DashboardPage {
  api = inject(Api);
  money = currency;
  date = dateText;
  compact = new Intl.NumberFormat('es-MX', { notation: 'compact', maximumFractionDigits: 1 });
  stats = signal<Stats | null>(null);
  message = signal('');
  busy = signal(false);
  start = '';
  end = '';
  status = '';
  owner = '';
  statuses = ['Registrada', 'En proceso', 'Completada', 'Cancelada'];
  stages = ['Nueva', 'En seguimiento', 'Propuesta', 'Negociación', 'Ganada', 'Perdida'];
  ngOnInit() { void this.load(); }
  async load() {
    this.busy.set(true);
    this.message.set('');
    const params = new URLSearchParams();
    if (this.start) params.set('desde', this.start);
    if (this.end) params.set('hasta', this.end);
    if (this.status) params.set('estado', this.status);
    if (this.owner) params.set('responsable', this.owner);
    try {
      const data = await this.api.get<Stats>('estadisticas?' + params);
      this.stats.set(data);
      if (!this.start) this.start = data.start;
      if (!this.end) this.end = data.end;
    } catch (error) { this.message.set(errorText(error)); }
    finally { this.busy.set(false); }
  }
  bar(value: number, stats: Stats) {
    return 100 * value / Math.max(1, ...stats.months.map(month => month.total));
  }
  stageCount(stage: string, stats: Stats) { return stats.stages.find(x => x.stage === stage)?.count || 0; }
  stagePercent(stage: string, stats: Stats) {
    return 100 * this.stageCount(stage, stats) / Math.max(1, ...stats.stages.map(x => x.count));
  }
}
