import { Component, ElementRef, effect, inject, input, output, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, currency, dateInput, dateText, errorText } from './api';

interface SnapshotLine { position: number; product: string; quantity: number; price: number; discount: number; }
interface QuoteVersion {
  id: number; at: string; actor: string; total: number; maxDiscount: number; approval: string; decisionBy: string;
  decisionReason: string; decidedAt: string | null; snapshot: {validUntil:string; terms:string; notes:string; taxRate:number; lines:SnapshotLine[]};
}
interface QuoteHistory { status: string; revision: string; versions: QuoteVersion[]; }
@Component({
  selector:'bumi-quote-versions', imports:[FormsModule], template:`
    <details class="improvement no-print" #panel (toggle)="panel.open && load()">
      <summary>Versiones y aprobación de descuentos</summary>
      <p class="muted">Los borradores con descuentos requieren aprobación. Una edición crea una revisión nueva.</p>
      @if (message) {<p class="error" role="alert">{{message}}</p>}
      @if (data; as history) {
        <div class="table-scroll"><table><thead><tr><th>Versión</th><th>Importe</th><th>Descuento máximo</th><th>Decisión</th></tr></thead>
          <tbody>@for (row of history.versions; track row.id; let i = $index) {
            <tr><td><button type="button" class="text-button" (click)="compare(i)">{{i === 0 ? 'Actual' : 'Ver versión ' + (history.versions.length-i)}}</button><small>{{row.actor}}</small></td>
              <td>{{money.format(row.total)}}</td><td>{{row.maxDiscount}} %</td><td>{{row.approval}} @if (row.decisionBy) {<small>{{row.decisionBy}} · {{date(row.decidedAt || '')}} · {{row.decisionReason}}</small>}</td></tr>
          }</tbody>
        </table></div>
        @if (selected; as row) {
          <section class="padded">
            <h3>{{money.format(row.total)}} · {{row.snapshot.taxRate}} % de impuesto</h3>
            <p>{{row.snapshot.terms || 'Sin condiciones adicionales'}} · Vigencia {{date(row.snapshot.validUntil)}}</p>
            @if (row !== history.versions[0]) {<p>Diferencia con la versión actual {{money.format(history.versions[0].total - row.total)}}</p>}
            @for (line of row.snapshot.lines; track line.position) {
              <div class="report-row"><span>{{line.product}} · {{line.quantity}} unidades</span><span>{{money.format(line.price)}} · {{line.discount}} % de descuento</span></div>
            }
          </section>
        }
        @if (api.manager && history.status === 'Borrador' && history.versions[0]?.approval === 'Pendiente') {
          <label>Motivo de la decisión<input [(ngModel)]="reason" maxlength="300"></label>
          <div class="actions">
            <button type="button" class="primary" [disabled]="busy || !reason.trim()" (click)="decide('Aprobada')">Aprobar</button>
            <button type="button" class="secondary" [disabled]="busy || !reason.trim()" (click)="decide('Rechazada')">Rechazar</button>
          </div>
        }
      }
    </details>
  `
})
export class QuoteVersions {
  api = inject(Api);
  quote = input.required<{id:number; status:string}>();
  panel = viewChild<ElementRef<HTMLDetailsElement>>('panel');
  data?: QuoteHistory;
  selected?: QuoteVersion;
  message = '';
  reason = '';
  busy = false;
  money = currency;
  date = dateText;
  constructor() {
    effect(() => {
      this.quote();
      this.data = undefined;
      this.selected = undefined;
      if (this.panel()?.nativeElement.open) void this.load();
    });
  }
  async load() {
    this.message = '';
    const quote = this.quote();
    try {
      const history = await this.api.get<QuoteHistory>('cotizaciones/' + quote.id + '/versiones');
      if (this.quote() === quote) this.data = history;
    }
    catch (error) { this.message = errorText(error); }
  }
  compare(index: number) { this.selected = this.data?.versions[index]; }
  async decide(decision: string) {
    if (!this.data || this.busy) return;
    this.busy = true;
    try {
      await this.api.send('PUT', 'cotizaciones/' + this.quote().id + '/aprobacion', {revision:this.data.revision, decision, reason:this.reason});
      this.reason = '';
      await this.load();
    } catch (error) { this.message = errorText(error); }
    finally { this.busy = false; }
  }
}

interface Fulfillment {id:number; position:number; quantity:number; kind:string; reason:string; effectiveOn:string; promisedOn:string|null; actor:string;}
interface FulfillmentDraft { position:number; quantity:number; kind:string; reason:string; effectiveOn:string; promisedOn:string; requestId:string; }
@Component({
  selector:'bumi-fulfillment', imports:[FormsModule], styleUrl:'./fulfillment.css', template:`
    <section class="panel fulfillment-card" aria-labelledby="fulfillment-heading">
      <header><h2 id="fulfillment-heading">Entregas y devoluciones</h2><p>Seguimiento por partida de esta venta</p></header>
      @if (message) {<p class="error" role="alert">{{message}} @if (!loaded && !loading) {<button type="button" class="text-button" (click)="load()">Reintentar</button>}</p>}
      @if (loading) {<p class="muted" role="status">Cargando movimientos…</p>}
      @if (loaded) {
        <div class="fulfillment-summary">
          <strong>Cumplimiento de la venta <b>{{completion()}} %</b></strong>
          <progress [value]="completion()" max="100" aria-label="Porcentaje neto entregado"></progress>
          <small>{{netDelivered()}} de {{soldTotal()}} unidades entregadas después de devoluciones</small>
        </div>
        <div class="fulfillment-lines">
          @for (line of lines(); track $index) {
            @let position = $index + 1;
            @let delivered = count(position, 'Entrega');
            @let returned = count(position, 'Devolución');
            <article>
              <strong>{{position}} · {{line.product}}</strong>
              <dl>
                <div><dt>Pedidas</dt><dd>{{line.quantity}}</dd></div>
                <div><dt>Entregadas</dt><dd>{{delivered}}</dd></div>
                <div><dt>Devueltas</dt><dd>{{returned}}</dd></div>
                <div><dt>Pendientes</dt><dd>{{line.quantity - delivered}}</dd></div>
              </dl>
              <progress [value]="delivered - returned" [max]="line.quantity" [attr.aria-label]="'Entrega neta de ' + line.product"></progress>
            </article>
          }
        </div>
        @if (status() !== 'Cancelada') {
          <form class="form-grid fulfillment-form" (ngSubmit)="save()">
            <h3 class="wide">Registrar movimiento</h3>
            <label class="wide">Movimiento<select name="kind" [(ngModel)]="draft.kind"><option>Entrega</option>@if (api.manager) {<option>Devolución</option>}</select></label>
            <label class="wide">Partida<select name="line" [(ngModel)]="draft.position">@for (line of lines(); track $index) {<option [ngValue]="$index+1">{{line.product}}</option>}</select></label>
            <label>Cantidad<input name="qty" type="number" min="1" step="1" [max]="maximum()" [(ngModel)]="draft.quantity" required></label>
            <label>Fecha efectiva<input name="effective" type="date" [(ngModel)]="draft.effectiveOn" required></label>
            @if (draft.kind === 'Entrega') {<label class="wide">Fecha prometida<input name="promised" type="date" [(ngModel)]="draft.promisedOn" required></label>}
            <label class="wide">Motivo<textarea name="reason" [(ngModel)]="draft.reason" maxlength="300" rows="2" required></textarea></label>
            @if (maximum() < 1) { <small class="muted wide">Sin unidades disponibles para este movimiento.</small> }
            <div class="form-actions wide"><button class="primary" [disabled]="!canSave()">Registrar movimiento</button></div>
          </form>
        }
        <section class="fulfillment-history">
          <h3>Movimientos de la venta</h3>
          @for (row of rows; track row.id) {
            <div class="report-row"><div><strong>{{row.kind}} · {{row.quantity}} unidades</strong><small>{{lines()[row.position-1]?.product}} · {{row.reason}}</small></div>
              <small>{{date(row.effectiveOn)}} · {{row.actor}} @if (row.promisedOn) { <br>Prometida {{date(row.promisedOn)}} }</small></div>
          } @empty { <p class="muted">Sin movimientos registrados.</p> }
        </section>
      }
    </section>
  `
})

export class FulfillmentTools {
  api = inject(Api);
  sale = input.required<number>();
  status = input.required<string>();
  lines = input.required<{product:string; quantity:number}[]>();
  changed = output<void>();
  rows: Fulfillment[] = [];
  draft = this.empty();
  message = '';
  busy = false;
  date = dateText;
  loading = false;
  loaded = false;
  constructor() {
    effect(() => {
      this.sale();
      this.message = '';
      this.rows = [];
      this.loaded = false;
      this.draft = this.empty();
      void this.load();
    });
  }
  empty(): FulfillmentDraft { return {position:1, quantity:1, kind:'Entrega', reason:'', effectiveOn:dateInput(), promisedOn:dateInput(), requestId:''}; }
  count(position:number, kind:string) { return this.rows.filter(x => x.position === position && x.kind === kind).reduce((n,x) => n+x.quantity,0); }
  soldTotal() { return this.lines().reduce((total, line) => total + line.quantity, 0); }
  netDelivered() { return this.rows.reduce((total, row) => total + (row.kind === 'Entrega' ? row.quantity : -row.quantity), 0); }
  completion() { return this.soldTotal() ? Math.round(this.netDelivered() * 100 / this.soldTotal()) : 0; }
  maximum() {
    const delivered = this.count(this.draft.position,'Entrega');
    return this.draft.kind === 'Entrega' ? (this.lines()[this.draft.position-1]?.quantity ?? 0)-delivered
      : delivered-this.count(this.draft.position,'Devolución');
  }
  async load() {
    const id = this.sale();
    this.loading = true;
    this.message = '';
    try {
      const rows = await this.api.get<Fulfillment[]>('ventas/' + id + '/entregas');
      if (this.sale() === id) { this.rows = rows; this.loaded = true; }
    } catch (error) { if (this.sale() === id) this.message = errorText(error); }
    finally { if (this.sale() === id) this.loading = false; }
  }
  canSave() {
    return this.loaded && !this.busy && !this.loading && this.status() !== 'Cancelada' &&
      Number.isInteger(this.draft.quantity) && this.draft.quantity >= 1 && this.draft.quantity <= this.maximum() &&
      !!this.draft.reason.trim() && !!this.draft.effectiveOn && (this.draft.kind !== 'Entrega' || !!this.draft.promisedOn);
  }
  async save() {
    if (!this.canSave()) return;
    const id = this.sale();
    this.busy = true;
    this.message = '';
    try {
      this.draft.requestId ||= crypto.randomUUID();
      await this.api.send('POST','ventas/' + id + '/entregas',{...this.draft, promisedOn:this.draft.kind === 'Entrega' ? this.draft.promisedOn : null});
      if (this.sale() !== id) return;
      this.draft = this.empty();
      await this.load();
      if (this.sale() === id) this.changed.emit();
    } catch (error) { if (this.sale() === id) this.message = errorText(error); }
    finally { this.busy = false; }
  }
}

@Component({
  selector:'bumi-fulfillment-metrics', template:`
    <details class="panel padded improvement" #panel (toggle)="panel.open && load()">
      <summary>Entregas a tiempo y devoluciones</summary>
      @if (message) {<p class="error" role="alert">{{message}}</p>}
      @if (data; as report) {
        <p>{{report.onTime}} entregas a tiempo de {{report.deliveries}} registradas desde {{date(report.fromDate)}}.</p>
        @for (row of report.returns; track row.name) {<div class="report-row"><span>{{row.name}}</span><strong>{{row.quantity}} devueltas</strong></div>}
      }
    </details>
  `
})
export class FulfillmentMetrics {
  api = inject(Api);
  date = dateText;
  data?: {fromDate:string; deliveries:number; onTime:number; returns:{name:string; quantity:number}[]};
  message = '';
  async load() {
    try { this.data = await this.api.get<NonNullable<typeof this.data>>('ventas/entregas/indicadores'); }
    catch (error) { this.message = errorText(error); }
  }
}
