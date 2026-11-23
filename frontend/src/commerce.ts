import { Component, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FulfillmentMetrics, FulfillmentTools, QuoteVersions } from './commerce-tools';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { CatalogProduct } from './stock';
import { Api, currency, dateInput, dateText, errorText, folio, PartyOption } from './api';
import { QuotePreview } from './quote-preview';
import { netLine, type QuoteLine as Line } from './commerce-values';

const paymentPrefix = 'Condiciones de pago: ';
const saleTimestamp = new Intl.DateTimeFormat('es-MX', { dateStyle:'medium', timeStyle:'short', timeZone:'America/Mexico_City' });
interface Amounts { subtotal: number; tax: number; total: number; lines: Line[]; }
interface Quote extends Amounts {
  id: number; partyId: number; party: string; owner: string; date: string; validUntil: string;
  status: string; terms: string; notes: string; taxRate: number; hasSale: boolean;
}
interface Sale extends Amounts {
  id: number; quoteId: number | null; party: string; owner: string; date: string; status: string;
  cancelReason: string; cancelledBy: string; cancelledAt: string | null;
}
interface SaleHistory { id: number; actor: string; status: string; description: string; at: string; }
interface DirectSale { partyId: number; reason: string; taxRate: number; lines: Line[]; }
interface Draft { id: number; partyId: number; validUntil: string; terms: string; notes: string; taxRate: number; lines: Line[]; }

@Component({
  selector: 'bumi-product-choice',
  imports: [FormsModule],
  template: `
    @if (catalog().length) {
      <label>Producto del catálogo<select [ngModel]="line().productId || null" [ngModelOptions]="{standalone:true}"
        (ngModelChange)="select($event)">
        <option [ngValue]="null">Capturar manualmente</option>
        @for (item of catalog(); track item.id) {
          <option [ngValue]="item.id">{{item.sku}} · {{item.name}} ({{item.stock}})</option>
        }
      </select></label>
    }
    <label>{{line().productId ? 'Producto seleccionado' : 'Descripción de la partida'}}
      <input [ngModel]="line().product" (ngModelChange)="line().product = $event" [ngModelOptions]="{standalone:true}"
        [readonly]="!!line().productId" maxlength="120" required>
    </label>
  `
})
export class ProductChoice {
  line = input.required<Line>();
  catalog = input.required<CatalogProduct[]>();
  select(id: number | null) {
    const item = this.catalog().find(value => value.id === id);
    const line = this.line();
    if (item) {
      line.productId = item.id;
      line.product = item.name;
      line.price = item.price;
    } else {
      if (line.productId) line.product = '';
      line.productId = null;
    }
  }
}

@Component({
  imports: [FormsModule, RouterLink, ProductChoice, QuoteVersions, QuotePreview],
  templateUrl: './quotes.html',
  styleUrl: './quotes.css',
})
export class QuotesPage {
  api = inject(Api);
  route = inject(ActivatedRoute);
  catalog: CatalogProduct[] = [];
  dueSoon = !!this.route.snapshot.queryParamMap.get('vence');
  money = currency;
  date = dateText;
  code = folio;
  today = dateInput();
  statuses = ['Borrador', 'Enviada', 'Aceptada', 'Rechazada', 'Vencida'];
  parties: PartyOption[] = [];
  quotes: Quote[] = [];
  edit: Draft | null = null;
  detail: Quote | null = null;
  productLines: Line[] = [];
  readonly paymentOptions = ['50% anticipo · 50% contra entrega', '100% por adelantado', '100% contra entrega',
    'Crédito a 15 días', 'Crédito a 30 días'];
  paymentChoice = '';
  customPayment = '';
  private get paymentHeader() {
    const value = (this.paymentChoice === 'custom' ? this.customPayment : this.paymentChoice).trim();
    return value ? paymentPrefix + value : '';
  }
  get termsLimit() { return 500 - (this.paymentHeader ? this.paymentHeader.length + 2 : 0); }
  preview = true;
  widePdf = false;
  filter = '';
  message = '';
  notice = '';
  busy = false;
  loading = true;
  saleCreated = false;

  async ngOnInit() {
    await this.load();
    const id = Number(this.route.snapshot.queryParamMap.get('id') || 0);
    this.openRequested(id);
    if (this.route.snapshot.queryParamMap.get('nueva') === '1') this.newQuote();
    else if (!this.detail) this.detail = this.filtered()[0] ?? null;
    if (this.api.enabled('inventario')) {
      try { this.catalog = (await this.api.get<CatalogProduct[]>('inventario')).filter(x => x.active); }
      catch (error) { this.message = errorText(error); }
    }
  }
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
  search = '';
  openRequested(id: number) {
    const item = this.quotes.find(x => x.id === id);
    if (item) this.open(item);
  }
  filtered() {
    const query = this.search.trim().toLocaleLowerCase('es-MX');
    return this.quotes.filter(x => (!this.filter || x.status === this.filter) &&
      (!this.dueSoon || (x.status === 'Enviada' && x.validUntil >= this.today && x.validUntil <= dateInput(7))) &&
      [x.party, folio('COT', x.id)].some(value => value.toLocaleLowerCase('es-MX').includes(query)));
  }
  newQuote() {
    this.detail = null;
    this.resetFeedback();
    this.paymentChoice = this.customPayment = '';
    this.edit = { id: 0, partyId: 0, validUntil: dateInput(14), taxRate: 16, terms: '', notes: '', lines: [] };
  }
  cancelEdit() { this.edit = null; }
  editQuote(q: Quote) {
    this.resetFeedback();
    this.paymentChoice = this.customPayment = '';
    let terms = q.terms;
    if (terms.startsWith(paymentPrefix)) {
      const [header, ...remaining] = terms.split('\n');
      const condition = header.slice(paymentPrefix.length).trim();
      this.paymentChoice = this.paymentOptions.includes(condition) ? condition : 'custom';
      if (this.paymentChoice === 'custom') this.customPayment = condition;
      terms = remaining.join('\n').trimStart();
    }
    this.edit = {...q, terms, lines: q.lines.map(line => ({...line}))};
    window.scrollTo({top: 0, behavior: 'smooth'});
  }
  open(q: Quote) {
    this.resetFeedback();
    this.edit = null;
    this.detail = q;
    this.preview = true;
  }
  openProducts(dialog: HTMLDialogElement) {
    if (!this.edit) return;
    this.productLines = this.edit.lines.map(line => ({...line}));
    if (!this.productLines.length) this.addProduct();
    dialog.showModal();
  }
  addProduct() { this.productLines.push({product: '', quantity: 1, price: 0, discount: 0}); }
  validProducts(lines: Line[]) {
    return lines.length > 0 && lines.every(line => line.product.trim() && Number.isInteger(line.quantity) &&
      line.quantity >= 1 && line.quantity <= 10000 && Number.isFinite(line.price) && line.price >= .01 &&
      line.price <= 1_000_000 && Number.isFinite(line.discount) && line.discount >= 0 && line.discount <= 100);
  }
  applyProducts(dialog: HTMLDialogElement) {
    if (!this.edit || !this.validProducts(this.productLines)) return;
    this.edit.lines = this.productLines;
    dialog.close();
  }
  resetFeedback() { this.message = this.notice = ''; this.saleCreated = false; }
  async save() {
    if (!this.edit || this.busy) return;
    if (!this.validProducts(this.edit.lines)) { this.message = 'Agrega al menos un producto con cantidad y precio válidos.'; return; }
    if (this.paymentChoice === 'custom' && !this.customPayment.trim()) { this.message = 'Captura la condición de pago.'; return; }
    const terms = [this.paymentHeader, this.edit.terms.trim()].filter(Boolean).join('\n\n');
    if (terms.length > 500) { this.message = 'La condición de pago y los términos deben sumar hasta 500 caracteres.'; return; }
    const quote = {...this.edit, terms};
    await this.mutate(async () => {
      const result = await this.api.send<{id: number}>(quote.id ? 'PUT' : 'POST',
        'cotizaciones' + (quote.id ? '/' + quote.id : ''), quote);
      this.edit = null;
      await this.load();
      this.detail = this.quotes.find(x => x.id === result.id) || null;
      this.preview = true;
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
  imports: [FormsModule, RouterLink, ProductChoice, FulfillmentTools, FulfillmentMetrics],
  templateUrl: './sales.html',
  styleUrl: './sales.css',
})
export class SalesPage {
  api = inject(Api);
  route = inject(ActivatedRoute);
  catalog: CatalogProduct[] = [];
  money = currency;
  date = dateText;
  code = folio;
  sales: Sale[] = [];
  search = '';
  historyDate = (value: string) => saleTimestamp.format(new Date(value));
  netLine = netLine;
  gross(sale: Sale) { return Math.round(sale.lines.reduce((total, line) => total + Math.round(line.price * 100) * line.quantity, 0)) / 100; }
  statusCount(status: string) { return this.sales.filter(sale => sale.status === status).length; }
  startCancellation() { this.reason = ''; this.cancelling = true; }
  detail: Sale | null = null;
  statuses = ['Registrada', 'En proceso', 'Completada', 'Cancelada'];
  filter = '';
  message = '';
  notice = '';
  busy = false;
  loading = true;
  cancelling = false;
  reason = '';
  direct: DirectSale | null = null;
  clients: PartyOption[] = [];
  history: SaleHistory[] = [];

  async ngOnInit() {
    await this.load();
    const id = Number(this.route.snapshot.queryParamMap.get('id') || 0);
    this.openRequested(id);
    if (this.api.enabled('inventario')) {
      try { this.catalog = (await this.api.get<CatalogProduct[]>('inventario')).filter(x => x.active); }
      catch (error) { this.message = errorText(error); }
    }
  }
  async load() {
    try {
      this.sales = await this.api.get<Sale[]>('ventas');
      if (this.detail) this.detail = this.sales.find(x => x.id === this.detail?.id) || null;
    } catch (error) { this.message = errorText(error); }
    finally { this.loading = false; }
  }
  openRequested(id: number) {
    const item = this.sales.find(x => x.id === id) ?? this.sales[0];
    if (item) void this.open(item);
  }
  filtered() {
    const query = this.search.trim().toLocaleLowerCase('es-MX');
    return this.sales.filter(sale => (!this.filter || sale.status === this.filter) &&
      [sale.party, sale.owner, this.code('VTA', sale.id), sale.quoteId ? this.code('COT', sale.quoteId) : '',
        ...sale.lines.map(line => line.product)].some(value => value.toLocaleLowerCase('es-MX').includes(query)));
  }
  async open(sale: Sale) {
    this.direct = null;
    this.detail = sale;
    this.history = [];
    this.message = this.notice = this.reason = '';
    this.cancelling = false;
    await this.loadHistory(sale.id);
  }
  async loadHistory(id: number) {
    try {
      const history = await this.api.get<SaleHistory[]>('ventas/' + id + '/historial');
      if (this.detail?.id === id) this.history = history;
    } catch (error) { if (this.detail?.id === id) this.message = errorText(error); }
  }
  async openDirectSale() {
    if (this.busy) return;
    this.busy = true;
    this.message = this.notice = '';
    try {
      this.clients = await this.api.get<PartyOption[]>('ventas/clientes');
      this.detail = null;
      this.cancelling = false;
      this.direct = {partyId: 0, taxRate: 16, reason: '', lines: []};
      this.addDirectLine();
    } catch (error) { this.message = errorText(error); }
    finally { this.busy = false; }
  }
  addDirectLine() { this.direct?.lines.push({product: '', quantity: 1, price: 0, discount: 0}); }
  async saveDirectSale() {
    if (this.busy || !this.direct) return;
    if (this.direct.lines.some(line => !line.product.trim())) { this.message = 'Captura el nombre de cada partida.'; return; }
    this.busy = true;
    this.message = this.notice = '';
    try {
      const result = await this.api.send<{id: number}>('POST', 'ventas/directa', this.direct);
      this.direct = null;
      await this.load();
      const sale = this.sales.find(item => item.id === result.id);
      if (sale) await this.open(sale);
      this.notice = 'Venta directa registrada y autorizada.';
    } catch (error) { this.message = errorText(error); }
    finally { this.busy = false; }
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
      await this.loadHistory(id);
      this.notice = 'Estado de la venta actualizado.';
    } catch (error) { this.message = errorText(error); }
    finally { this.busy = false; }
  }
}
