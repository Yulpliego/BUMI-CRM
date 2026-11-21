import { Component, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, currency, dateInput, dateText, errorText, folio, PartyOption } from './api';

interface Line { product: string; quantity: number; price: number; discount: number; }
interface Amounts { subtotal: number; tax: number; total: number; lines: Line[]; }
interface Quote extends Amounts {
  id: number; partyId: number; party: string; owner: string; date: string; validUntil: string;
  status: string; terms: string; notes: string; taxRate: number; hasSale: boolean;
}
interface Sale extends Amounts {
  id: number; quoteId: number; party: string; owner: string; date: string; status: string;
  cancelReason: string; cancelledBy: string; cancelledAt: string | null;
}
interface Draft { id: number; partyId: number; validUntil: string; terms: string; notes: string; taxRate: number; lines: Line[]; }

@Component({
  selector: 'crm-amounts',
  template: `
    <div class="table-scroll line-list"><table>
      <thead><tr><th>Producto</th><th>Cantidad</th><th>Precio unitario</th><th>Descuento</th></tr></thead>
      <tbody>@for (line of details().lines; track $index) {
        <tr><td>{{line.product}}</td><td>{{line.quantity}}</td><td>{{money.format(line.price)}}</td><td>{{line.discount}} %</td></tr>
      }</tbody>
    </table></div>
    <dl class="totals">
      <div><dt>Subtotal</dt><dd>{{money.format(details().subtotal)}}</dd></div>
      <div><dt>Impuestos</dt><dd>{{money.format(details().tax)}}</dd></div>
      <div><dt>Total MXN</dt><dd>{{money.format(details().total)}}</dd></div>
    </dl>
  `
})
export class AmountsView {
  details = input.required<Amounts>();
  money = currency;
}

@Component({
  imports: [FormsModule, RouterLink, AmountsView],
  template: `
    <header class="page-head"><div><p class="eyebrow">PROPUESTAS COMERCIALES</p><h1>Cotizaciones</h1><p>Prepara propuestas y da seguimiento a su aceptación.</p></div>
      <button class="primary" (click)="newQuote()">+ Nueva cotización</button></header>
    @if (notice) { <p class="notice" role="status">{{notice}} @if (saleCreated && api.enabled('ventas')) { <a routerLink="/ventas">Ver ventas</a> }</p> }
    @if (message) { <p class="error" role="alert">{{message}}</p> }

    @if (edit; as q) {
      <section class="panel padded editor">
        <header class="section-head"><h2>{{q.id ? 'Editar ' + code('COT', q.id) : 'Nueva cotización'}}</h2><button class="secondary" (click)="edit = null">Cerrar</button></header>
        @if (!parties.length) {
          <p class="empty">Registra un cliente o prospecto activo para poder cotizar.</p>
        } @else {
          <form class="stack" (ngSubmit)="save()">
            <div class="form-grid">
              <label>Destinatario<select name="party" [(ngModel)]="q.partyId" required>
                <option [ngValue]="0" disabled>Selecciona un destinatario</option>
                @for (party of parties; track party.id) {<option [ngValue]="party.id">{{party.name}} · {{party.kind}}</option>}
              </select></label>
              <label>Vigencia<input type="date" name="valid" [(ngModel)]="q.validUntil" [min]="today" required></label>
              <label>Impuesto (%)<input type="number" name="tax" [(ngModel)]="q.taxRate" min="0" max="100" step="0.01" required></label>
              <label>Condiciones<input name="terms" [(ngModel)]="q.terms" maxlength="500"></label>
              <label class="wide">Observaciones<textarea name="notes" [(ngModel)]="q.notes" maxlength="500" rows="2"></textarea></label>
            </div>
            <div class="section-head"><h3>Productos</h3><button type="button" class="secondary" [disabled]="q.lines.length >= 50" (click)="addLine()">+ Agregar producto</button></div>
            @for (line of q.lines; track line; let i = $index) {
              <div class="line-editor">
                <label>Producto<input [name]="'product'+i" [(ngModel)]="line.product" maxlength="120" required></label>
                <label>Cantidad<input [name]="'quantity'+i" type="number" [(ngModel)]="line.quantity" min="1" max="10000" step="1" required></label>
                <label>Precio en MXN<input [name]="'price'+i" type="number" [(ngModel)]="line.price" min="0.01" max="1000000" step="0.01" required></label>
                @if (api.manager) {<label>Descuento (%)<input [name]="'discount'+i" type="number" [(ngModel)]="line.discount" min="0" max="100" step="0.01" required></label>}
                @if (q.lines.length > 1) {<button type="button" class="secondary" (click)="q.lines.splice(i, 1)" [attr.aria-label]="'Quitar producto ' + (i+1)">Quitar</button>}
              </div>
            }
            <div class="form-actions"><button class="primary" [disabled]="busy || !q.partyId">Guardar borrador</button></div>
          </form>
        }
      </section>
    }

    @if (detail; as q) {
      <section class="panel padded editor print-target">
        <header class="section-head"><div><h2>{{code('COT', q.id)}} · {{q.party}}</h2><p>Emitida {{date(q.date)}} · Vigencia {{date(q.validUntil)}} · {{q.owner}}</p></div>
          <div class="actions no-print"><button class="secondary" (click)="print()">Imprimir</button><button class="secondary" (click)="detail = null">Cerrar detalle</button></div>
        </header>
        <crm-amounts [details]="q" />
        @if (q.terms) {<p><b>Condiciones</b> · {{q.terms}}</p>}
        @if (q.notes) {<p><b>Observaciones</b> · {{q.notes}}</p>}
        <div class="actions no-print">
          <span class="badge" [attr.data-status]="q.status">{{q.status}}</span>
          @switch (q.status) {
            @case ('Borrador') {
              <button class="secondary" (click)="editQuote(q)">Editar borrador</button>
              <button class="primary" (click)="changeStatus(q.id, 'Enviada')" [disabled]="busy || q.validUntil < today">Marcar enviada</button>
            }
            @case ('Enviada') {
              <button class="primary" (click)="changeStatus(q.id, 'Aceptada')" [disabled]="busy">Aceptar</button>
              <button class="secondary" (click)="changeStatus(q.id, 'Rechazada')" [disabled]="busy">Rechazar</button>
            }
            @case ('Aceptada') {
              @if (q.hasSale) {<span>Venta registrada</span>}
              @else if (api.enabled('ventas')) {<button class="primary" (click)="createSale(q.id)" [disabled]="busy">Registrar venta</button>}
            }
          }
        </div>
      </section>
    }

    <section class="panel table-panel">
      <div class="table-head"><h2>Registro de cotizaciones</h2><label class="inline-label">Estado<select [(ngModel)]="filter">
        <option value="">Todos</option>@for (status of statuses; track status) {<option>{{status}}</option>}
      </select></label></div>
      <div class="table-scroll"><table>
        <thead><tr><th>Folio</th><th>Destinatario</th><th>Vigencia</th><th>Total MXN</th><th>Estado</th><th><span class="sr-only">Acciones</span></th></tr></thead>
        <tbody>
          @for (q of filtered(); track q.id) {
            <tr><td><strong>{{code('COT', q.id)}}</strong></td><td>{{q.party}}<small>{{q.owner}}</small></td><td>{{date(q.validUntil)}}</td>
              <td><strong>{{money.format(q.total)}}</strong></td><td><span class="badge" [attr.data-status]="q.status">{{q.status}}</span></td>
              <td><button class="text-button" (click)="open(q)">Ver detalle</button></td></tr>
          } @empty {<tr><td colspan="6" class="empty">{{loading ? 'Cargando cotizaciones…' : 'No hay cotizaciones para mostrar.'}}</td></tr>}
        </tbody>
      </table></div>
    </section>
  `
})
export class QuotesPage {
  api = inject(Api);
  money = currency;
  date = dateText;
  code = folio;
  today = dateInput();
  statuses = ['Borrador', 'Enviada', 'Aceptada', 'Rechazada', 'Vencida'];
  parties: PartyOption[] = [];
  quotes: Quote[] = [];
  edit: Draft | null = null;
  detail: Quote | null = null;
  filter = '';
  message = '';
  notice = '';
  busy = false;
  loading = true;
  saleCreated = false;

  ngOnInit() { void this.load(); }
  async load() {
    try {
      [this.quotes, this.parties] = await Promise.all([
        this.api.get<Quote[]>('cotizaciones'),
        this.api.get<PartyOption[]>('cotizaciones/destinatarios')
      ]);
      if (this.detail) this.detail = this.quotes.find(x => x.id === this.detail?.id) || null;
    } catch (error) { this.message = errorText(error); }
    finally { this.loading = false; }
  }
  filtered() { return this.quotes.filter(x => !this.filter || x.status === this.filter); }
  newQuote() {
    this.detail = null;
    this.resetFeedback();
    this.edit = { id: 0, partyId: 0, validUntil: dateInput(14), taxRate: 16, terms: '', notes: '', lines: [] };
    this.addLine();
  }
  editQuote(q: Quote) {
    this.resetFeedback();
    this.edit = {...q, lines: q.lines.map(line => ({...line}))};
    window.scrollTo({top: 0, behavior: 'smooth'});
  }
  open(q: Quote) {
    this.resetFeedback();
    this.edit = null;
    this.detail = q;
    window.scrollTo({top: 0, behavior: 'smooth'});
  }
  addLine() { this.edit?.lines.push({product: '', quantity: 1, price: 0, discount: 0}); }
  print() { window.print(); }
  resetFeedback() { this.message = this.notice = ''; this.saleCreated = false; }
  async save() {
    if (!this.edit || this.busy) return;
    const quote = this.edit;
    await this.mutate(async () => {
      const result = await this.api.send<{id: number}>(quote.id ? 'PUT' : 'POST',
        'cotizaciones' + (quote.id ? '/' + quote.id : ''), quote);
      this.edit = null;
      await this.load();
      this.detail = this.quotes.find(x => x.id === result.id) || null;
      this.notice = 'Borrador guardado.';
    });
  }
  async changeStatus(id: number, status: string) {
    await this.mutate(async () => {
      await this.api.send('PATCH', 'cotizaciones/' + id + '/estado', {status});
      await this.load();
      this.notice = 'Estado actualizado.';
    });
  }
  async createSale(id: number) {
    await this.mutate(async () => {
      await this.api.send('POST', 'ventas/cotizacion/' + id);
      await this.load();
      this.saleCreated = true;
      this.notice = 'Venta registrada.';
    });
  }
  private async mutate(operation: () => Promise<void>) {
    if (this.busy) return;
    this.busy = true;
    this.resetFeedback();
    try { await operation(); }
    catch (error) { this.message = errorText(error); }
    finally { this.busy = false; }
  }
}

@Component({
  imports: [FormsModule, RouterLink, AmountsView],
  template: `
    <header class="page-head"><div><p class="eyebrow">OPERACIÓN COMERCIAL</p><h1>Ventas</h1><p>Consulta tus operaciones y actualiza su seguimiento.</p></div>
      @if (api.enabled('cotizaciones')) {<a class="secondary button" routerLink="/cotizaciones">Ver cotizaciones</a>}</header>
    @if (notice) {<p class="notice" role="status">{{notice}}</p>}
    @if (message) {<p class="error" role="alert">{{message}}</p>}

    @if (detail; as s) {
      <section class="panel padded editor">
        <header class="section-head"><div><h2>{{code('VTA', s.id)}} · {{s.party}}</h2><p>{{code('COT', s.quoteId)}} · {{date(s.date)}} · {{s.owner}}</p></div>
          <button class="secondary" (click)="detail = null; cancelling = false">Cerrar detalle</button></header>
        <crm-amounts [details]="s" />
        <div class="actions">
          <span class="badge" [attr.data-status]="s.status">{{s.status}}</span>
          @if (s.status === 'Registrada') {<button class="primary" [disabled]="busy" (click)="update(s.id, 'En proceso')">Poner en proceso</button>}
          @if (s.status === 'En proceso') {<button class="primary" [disabled]="busy" (click)="update(s.id, 'Completada')">Marcar completada</button>}
          @if (api.manager && s.status !== 'Cancelada') {<button class="secondary danger" [disabled]="busy" (click)="cancelling = !cancelling">Cancelar venta</button>}
        </div>
        @if (cancelling) {
          <form class="stack subform" (ngSubmit)="update(s.id, 'Cancelada')">
            <label>Motivo de cancelación<input name="reason" [(ngModel)]="reason" required maxlength="300"></label>
            <div class="actions"><button class="danger secondary" [disabled]="busy">Confirmar cancelación</button>
              <button type="button" class="secondary" (click)="cancelling = false">Volver</button></div>
          </form>
        }
        @if (s.cancelReason) {<p class="notice">Cancelada por {{s.cancelledBy}} el {{date(s.cancelledAt || '')}}. Motivo registrado: {{s.cancelReason}}</p>}
      </section>
    }

    <section class="panel table-panel">
      <div class="table-head"><h2>Registro de ventas</h2><label class="inline-label">Estado<select [(ngModel)]="filter">
        <option value="">Todos</option>@for (value of statuses; track value) {<option>{{value}}</option>}
      </select></label></div>
      <div class="table-scroll"><table>
        <thead><tr><th>Folio</th><th>Cliente</th><th>Fecha</th><th>Total MXN</th><th>Estado</th><th><span class="sr-only">Acciones</span></th></tr></thead>
        <tbody>
          @for (s of filtered(); track s.id) {
            <tr><td><strong>{{code('VTA', s.id)}}</strong><small>{{code('COT', s.quoteId)}}</small></td>
              <td>{{s.party}}<small>{{s.owner}}</small></td><td>{{date(s.date)}}</td><td><strong>{{money.format(s.total)}}</strong></td>
              <td><span class="badge" [attr.data-status]="s.status">{{s.status}}</span></td>
              <td><button class="text-button" (click)="open(s)">Ver detalle</button></td></tr>
          } @empty {<tr><td colspan="6" class="empty">{{loading ? 'Cargando ventas…' : 'No hay ventas para mostrar.'}}</td></tr>}
        </tbody>
      </table></div>
    </section>
  `
})
export class SalesPage {
  api = inject(Api);
  money = currency;
  date = dateText;
  code = folio;
  sales: Sale[] = [];
  detail: Sale | null = null;
  statuses = ['Registrada', 'En proceso', 'Completada', 'Cancelada'];
  filter = '';
  message = '';
  notice = '';
  busy = false;
  loading = true;
  cancelling = false;
  reason = '';

  ngOnInit() { void this.load(); }
  async load() {
    try {
      this.sales = await this.api.get<Sale[]>('ventas');
      if (this.detail) this.detail = this.sales.find(x => x.id === this.detail?.id) || null;
    } catch (error) { this.message = errorText(error); }
    finally { this.loading = false; }
  }
  filtered() { return this.sales.filter(x => !this.filter || x.status === this.filter); }
  open(sale: Sale) {
    this.detail = sale;
    this.message = this.notice = this.reason = '';
    this.cancelling = false;
    window.scrollTo({top: 0, behavior: 'smooth'});
  }
  async update(id: number, status: string) {
    if (this.busy) return;
    this.busy = true;
    this.message = this.notice = '';
    try {
      await this.api.send('PATCH', 'ventas/' + id + '/estado', {status, reason: this.reason});
      this.cancelling = false;
      this.reason = '';
      await this.load();
      this.notice = 'Estado de la venta actualizado.';
    } catch (error) { this.message = errorText(error); }
    finally { this.busy = false; }
  }
}
