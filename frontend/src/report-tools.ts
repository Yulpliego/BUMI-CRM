import { Component, effect, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, currency, dateText, errorText, folio } from './api';

export interface Validation {label:string; actual:number; expected:number; error:number;}
interface Driver {name:string; delta:number;}
export interface Variation { previous:string; current:string; delta:number; percent:number|null; flagged:boolean;
  owners:Driver[]; campaigns:Driver[]; products:Driver[]; }
interface Operation {id:number; date:string|null; status:string; party:string; owner:string; total:number|null; partyId?:number; description?:string;}
type Source = 'ventas'|'cotizaciones'|'cartera'|'oportunidades';
interface Report {rows:Operation[]; count:number; page:number;}
@Component({
  selector:'bumi-report-tools', imports:[FormsModule,RouterLink], template:`
    <section class="panel padded improvement report-tools">
      <header class="section-head"><div><h2>{{showModel() ? 'Detalle operativo y cambios de ventas' : 'Operaciones detrás de las cifras'}}</h2><p>{{showModel() ? 'Consulta de dónde vienen las cifras y qué cambió entre los últimos meses cerrados.' : 'Consulta los registros de los filtros aplicados.'}}</p></div></header>
      @if (showModel() && variation(); as item) {
        <section class="subform">
          <h3>{{item.flagged ? 'Variación comercial atípica' : 'Variación entre meses cerrados'}}</h3>
          <p>{{item.previous}} a {{item.current}} · {{money.format(item.delta)}} @if (item.percent !== null) { · {{item.percent}} % }</p>
          @if (item.flagged) {
            <p class="muted">La alerta se activa a partir de 25 % y $1,000 MXN de cambio. Los desgloses muestran dónde varió el importe.</p>
            <div class="metrics report-drivers">
              @for (group of drivers(item); track group.title) {
                <div><h3>{{group.title}}</h3>
                  @for (row of group.items; track row.name) {<div class="report-row"><span>{{row.name}}</span><strong>{{money.format(row.delta)}}</strong></div>}
                  @empty {<p class="muted">Sin registros para este grupo.</p>}
                </div>
              }
            </div>
          }
        </section>
      }
      @if (showModel()) {<details class="improvement">
        <summary>Ver cifras y errores de la validación histórica</summary>
        <p class="muted">Cada predicción se recalcula usando únicamente los meses anteriores al mes evaluado.</p>
        <div class="table-scroll"><table><thead><tr><th>Mes cerrado</th><th>Pronóstico</th><th>Resultado real</th><th>Error absoluto</th></tr></thead>
          <tbody>@for (row of validation(); track row.label) {<tr><td>{{row.label}}</td><td>{{money.format(row.expected)}}</td><td>{{money.format(row.actual)}}</td><td>{{money.format(row.error)}}</td></tr>}
          @empty {<tr><td colspan="4">Se necesitan meses cerrados adicionales para evaluar el pronóstico.</td></tr>}</tbody></table></div>
      </details>}
      @if (source) {<details class="improvement" #panel (toggle)="panel.open && load(1)">
        <summary>Operaciones detrás de las cifras</summary>
        <form class="filters" (ngSubmit)="load(1)">
          <label>Datos del indicador<select name="source" [(ngModel)]="source" (ngModelChange)="resetSource()">
            @if (api.enabled('ventas')) {<option value="ventas">Ventas</option>}
            @if (api.enabled('cotizaciones')) {<option value="cotizaciones">Cotizaciones y aceptación</option>}
            @if (api.enabled('clientes')) {<option value="cartera">Cartera activa</option><option value="oportunidades">Embudo comercial</option>}
          </select></label>
          @if (source === 'ventas') {
          <label>Mes<select name="month" [(ngModel)]="month"><option value="">Todo el periodo</option>
            @for (row of months(); track row.month) {<option [value]="row.month">{{row.label}}</option>}</select></label>
          <label>Producto<select name="product" [(ngModel)]="product"><option value="">Todos</option>
            @for (row of products(); track row.name) {<option [value]="row.name">{{row.name}}</option>}</select></label>
          <label>Responsable<select name="seller" [(ngModel)]="seller"><option value="">Todos</option>
            @for (row of sellers(); track row.name) {<option [value]="row.name">{{row.name}}</option>}</select></label>
          }
          <label>{{source === 'cartera' ? 'Tipo de ficha' : source === 'oportunidades' ? 'Etapa' : 'Estado'}}
            <select name="status" [(ngModel)]="status"><option value="">Todos</option>
              @for (value of availableStates(); track value) {<option [value]="value">{{value}}</option>}
            </select></label>
          <button class="secondary" [disabled]="busy">Consultar operaciones</button>
        </form>
        @if (message) {<p class="error" role="alert">{{message}}</p>}
        @if (data; as report) {
          <div class="table-scroll"><table><thead><tr><th>Folio</th><th>Cliente</th><th>Fecha</th><th>Responsable</th><th>Estado</th><th>{{source === 'oportunidades' ? 'Valor estimado' : 'Importe'}}</th></tr></thead>
            <tbody>@for (row of report.rows; track row.id) {
              <tr><td>
                @if (source === 'ventas' && api.enabled('ventas')) {<a routerLink="/ventas" [queryParams]="{id:row.id}">{{code('VTA',row.id)}}</a>}
                @else if (source === 'cotizaciones') {<a routerLink="/cotizaciones" [queryParams]="{id:row.id}">{{code('COT',row.id)}}</a>}
                @else if (row.partyId) {<a routerLink="/clientes" [queryParams]="{ficha:row.partyId}">{{row.description || '#' + row.id}}</a>}
                @else { {{code('VTA',row.id)}} }
              </td><td>{{row.party}}</td><td>{{date(row.date ?? '')}}</td><td>{{row.owner}}</td><td>{{row.status}}</td>
                <td>{{row.total === null ? '—' : money.format(row.total)}}</td></tr>
            } @empty {<tr><td colspan="6">Sin operaciones para este filtro.</td></tr>}</tbody></table></div>
          <div class="actions"><button type="button" class="secondary" [disabled]="busy || report.page <= 1" (click)="load(report.page-1)">Anterior</button>
            <span>{{report.count}} operaciones · Página {{report.page}}</span>
            <button type="button" class="secondary" [disabled]="busy || report.page*25 >= report.count" (click)="load(report.page+1)">Siguiente</button></div>
        }
      </details>}
    </section>
  `
})
export class ReportTools {
  api = inject(Api);
  money = currency;
  code = folio;
  date = dateText;
  filters = input.required<string>();
  months = input.required<{month:string;label:string}[]>();
  products = input.required<{name:string}[]>();
  sellers = input.required<{name:string}[]>();
  statuses = input.required<{status:string}[]>();
  validation = input.required<Validation[]>();
  variation = input.required<Variation|null>();
  showModel = input(false);
  source:Source|'' = this.api.enabled('ventas') ? 'ventas' :
    this.api.enabled('cotizaciones') ? 'cotizaciones' : this.api.enabled('clientes') ? 'cartera' : '';
  month = '';
  product = '';
  seller = '';
  status = '';
  data?:Report;
  message = '';
  busy = false;
  constructor() {
    effect(() => { this.filters(); this.data = undefined; this.month = this.product = this.seller = this.status = ''; });
  }
  resetSource() {
    this.data = undefined;
    this.month = this.product = this.seller = this.status = '';
  }
  availableStates() {
    if (this.source === 'cartera') return ['Cliente','Prospecto'];
    if (this.source === 'oportunidades') return ['Nueva','En seguimiento','Propuesta','Negociación','Ganada','Perdida'];
    if (this.source === 'cotizaciones') return ['Borrador','Enviada','Aceptada','Rechazada','Vencida'];
    return this.statuses().map(x=>x.status);
  }
  drivers(item:Variation) {
    return [{title:'Responsables',items:item.owners},{title:'Productos antes de impuestos',items:item.products},
      {title:'Campañas atribuidas',items:item.campaigns}];
  }
  async load(page:number) {
    if (this.busy || !this.source) return;
    this.busy = true;
    this.message = '';
    const base = this.filters();
    const source = this.source;
    const params = new URLSearchParams(base);
    if (source !== 'ventas') params.set('origen',source);
    if (this.month) params.set('mes',this.month);
    if (this.product) params.set('producto',this.product);
    if (this.seller) params.set('vendedor',this.seller);
    if (this.status) params.set('estadoDetalle',this.status);
    params.set('pagina',String(page));
    try {
      const endpoint = source === 'ventas' ? 'estadisticas/operaciones' : 'estadisticas/registros';
      const result = await this.api.get<Report>(endpoint+'?'+params);
      if (base === this.filters() && source === this.source) this.data = result;
    }
    catch (error) {this.message = errorText(error);}
    finally {this.busy = false;}
  }
}
