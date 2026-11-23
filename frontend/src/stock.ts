import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PurchasePanel, ReplenishmentPanel } from './supply-tools';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api, currency, errorText, folio } from './api';

export interface CatalogProduct { id: number; sku: string; name: string; price: number; stock: number; unit: string; active: boolean; }
interface Product extends CatalogProduct { description: string; category: string; minimum: number; }
type Movement = {id: number; at: string; type: string; reason: string; delta: number; balance: number; actor: string; saleId: number | null};
type Supplier = {id: number; name: string; contact: string; rfc: string; email: string; phone: string; address: string; active: boolean;
  products: {id: number; sku: string; name: string; active: boolean}[]};
const movementDate = new Intl.DateTimeFormat('es-MX', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City'});
const time = (at: string) => movementDate.format(new Date(at));
type InventoryFilter = 'all' | 'low' | 'empty';

@Component({
  imports: [FormsModule, RouterLink, ReplenishmentPanel],
  templateUrl: './inventory.html',
  styleUrl: './inventory.css',
})
export class InventoryPage {
  api = inject(Api);
  route = inject(ActivatedRoute);
  rows: Product[] = [];
  movements: Movement[] = [];
  draft: Product | null = null;
  current: Product | null = null;
  search = '';
  filter: InventoryFilter = this.route.snapshot.queryParamMap.has('bajo') ? 'low' : 'all';
  page = 1;
  readonly pageSize = 10;
  readonly number = new Intl.NumberFormat('es-MX');
  revision = 0;
  loading = true;
  historyLoading = false;
  showMovement = false;
  allMovements = false;
  private historyRequest = 0;
  message = '';
  money = currency;
  format = time;
  code = folio;
  busy = false;
  moveType = 'Entrada';
  quantity = 1;
  reason = '';
  get canEdit() { return ['Administrador','Inventario'].includes(this.api.profile()?.role || ''); }
  label(item: Product) { return !item.active ? 'Inactivo' : item.stock === 0 ? 'Agotado' : item.stock <= item.minimum ? 'En mínimo' : 'Disponible'; }
  activeCount() { return this.rows.filter(item => item.active).length; }
  stockValue() {
    return this.rows.reduce((total, item) => item.active ? total + Math.round(item.price * 100) * item.stock : total, 0) / 100;
  }
  setFilter(value: InventoryFilter) { this.filter = value; this.page = 1; }
  pageCount(count: number) { return Math.max(1, Math.ceil(count / this.pageSize)); }
  visibleMovements() { return this.allMovements ? this.movements : this.movements.slice(0, 6); }
  selectHistory(id: number) {
    const item = this.rows.find(row => row.id === id);
    if (item) void this.open(item);
    else {
      this.historyRequest++;
      this.current = null;
      this.movements = [];
      this.historyLoading = false;
      this.showMovement = false;
    }
  }
  lowCount() { return this.rows.filter(item => item.active && item.stock <= item.minimum).length; }
  emptyCount() { return this.rows.filter(item => item.active && item.stock === 0).length; }
  filtered() {
    const query = this.search.trim().toLocaleLowerCase('es-MX');
    return this.rows.filter(item => (this.filter === 'all' || (item.active &&
      (this.filter === 'empty' ? item.stock === 0 : item.stock <= item.minimum))) &&
      [item.name, item.sku, item.category].some(value => value.toLocaleLowerCase('es-MX').includes(query)));
  }
  async ngOnInit() {
    await this.load();
    const id = Number(this.route.snapshot.queryParamMap.get('id') || 0);
    const current = this.rows.find(item => item.id === id) ?? this.filtered()[0] ?? this.rows[0];
    if (current) await this.open(current);
  }
  async load() {
    try {
      this.rows = await this.api.get<Product[]>('inventario');
      this.page = Math.min(this.page, this.pageCount(this.filtered().length));
    } catch (error) { this.message = errorText(error); }
    finally { this.loading = false; }
  }
  create() {
    this.draft = {id: 0, sku: '', name: '', price: 0, stock: 0, minimum: 0, category: '', unit: 'Pieza', active: true, description: ''};
    this.message = '';
    window.scrollTo({top:0,behavior:'smooth'});
  }
  edit(item: Product) { this.draft = {...item}; this.message = ''; window.scrollTo({top:0,behavior:'smooth'}); }
  async save() {
    if (this.busy || !this.draft) return;
    this.busy = true;
    this.message = '';
    try {
      const id = this.draft.id;
      const result = await this.api.send<Product>(id ? 'PUT' : 'POST', 'inventario' + (id ? '/' + id : ''), this.draft);
      this.draft = null;
      await this.load();
      this.revision++;
      await this.open(result, true);
    } catch (error) { this.message = errorText(error); }
    finally { this.busy = false; }
  }
  async open(item: Product, scroll = false) {
    const request = ++this.historyRequest;
    this.draft = null;
    this.message = '';
    this.current = item;
    this.movements = [];
    this.showMovement = this.allMovements = false;
    this.historyLoading = true;
    this.moveType = 'Entrada';
    this.quantity = 1;
    this.reason = '';
    if (scroll) document.getElementById('stock-history')?.scrollIntoView({behavior:'smooth'});
    try {
      const history = await this.api.get<Movement[]>('inventario/' + item.id + '/movimientos');
      if (request === this.historyRequest) this.movements = history;
    } catch (error) { if (request === this.historyRequest) this.message = errorText(error); }
    finally { if (request === this.historyRequest) this.historyLoading = false; }
  }
  async move(id: number) {
    if (this.busy) return;
    this.busy = true;
    this.message = '';
    try {
      const result = await this.api.send<Product>('POST', 'inventario/' + id + '/movimientos',
        {type: this.moveType, quantity: this.quantity, reason: this.reason});
      this.reason = '';
      this.quantity = 1;
      await this.load();
      this.revision++;
      await this.open(result);
      void this.api.refreshNotices();
    } catch (error) { this.message = errorText(error); }
    finally { this.busy = false; }
  }
}

@Component({
  imports: [FormsModule, RouterLink, PurchasePanel],
  templateUrl: './suppliers.html',
  styleUrl: './workspaces.css',
})
export class SuppliersPage {
  api = inject(Api);
  selectedId = Number(inject(ActivatedRoute).snapshot.queryParamMap.get('id') || 0);
  rows: Supplier[] = [];
  inventory: Product[] = [];
  readonly supplierFilters = [{value:'', label:'Todos'}, {value:'active', label:'Activos'}, {value:'inactive', label:'Inactivos'}];
  catalog: CatalogProduct[] = [];
  draft: Supplier | null = null;
  ids: number[] = [];
  state = '';
  search = '';
  busy = false;
  message = '';
  get canEdit() { return ['Administrador','Compras'].includes(this.api.profile()?.role || ''); }
  async ngOnInit() { await this.load(); }
  async load() {
    try {
      [this.rows,this.catalog,this.inventory] = await Promise.all([
        this.api.get<Supplier[]>('proveedores'),
        this.api.get<CatalogProduct[]>('proveedores/productos'),
        this.api.enabled('inventario') ? this.api.get<Product[]>('inventario').catch(() => []) : Promise.resolve([])
      ]);
    } catch (error) { this.message = errorText(error); }
  }
  filtered() {
    const query = this.search.trim().toLocaleLowerCase('es-MX');
    return this.rows.filter(item => (!this.state || item.active === (this.state === 'active')) &&
      [item.name, item.rfc, item.contact, ...item.products.flatMap(value => [value.name, value.sku])]
        .some(value => value.toLocaleLowerCase('es-MX').includes(query)));
  }
  selected(): Supplier | undefined {
    const visible = this.filtered();
    return visible.find(row => row.id === this.selectedId) ?? visible[0];
  }
  activeCount() { return this.rows.filter(row => row.active).length; }
  productStock(id: number): (CatalogProduct & {minimum?: number}) | undefined {
    return this.inventory.find(row => row.id === id) ?? this.catalog.find(row => row.id === id);
  }
  stockStatus(product: (CatalogProduct & {minimum?: number}) | undefined) {
    if (!product) return 'Sin datos';
    if (product.stock === 0) return 'Agotado';
    return product.minimum !== undefined && product.stock <= product.minimum ? 'Stock bajo' : 'Disponible';
  }
  shortages() {
    const ids = new Set(this.rows.filter(row => row.active).flatMap(row => row.products.filter(product => product.active).map(product => product.id)));
    return [...ids].flatMap(id => {
      const product = this.productStock(id);
      return product && ['Stock bajo', 'Agotado'].includes(this.stockStatus(product)) ? [product] : [];
    });
  }
  shortageText(products: CatalogProduct[]) {
    const sample = products.slice(0, 3).map(product => product.sku + ' · ' + product.name + ' (' + product.stock + ' disponibles)').join(' / ');
    return products.length > 3 ? sample + ' y ' + (products.length - 3) + ' más' : sample;
  }
  create() { this.edit({id:0,name:'',contact:'',rfc:'',email:'',phone:'',address:'',active:true,products:[]}); }
  edit(item: Supplier) {
    this.draft = {...item};
    this.ids = item.products.map(value => value.id);
    this.message = '';
    window.scrollTo({top:0,behavior:'smooth'});
  }
  toggle(id: number, event: Event) {
    this.ids = (event.target as HTMLInputElement).checked
      ? [...new Set([...this.ids,id])] : this.ids.filter(value => value !== id);
  }
  async save() {
    if (this.busy || !this.draft) return;
    this.busy = true;
    this.message = '';
    try {
      const id = this.draft.id;
      const saved = await this.api.send<{id: number}>(id ? 'PUT' : 'POST','proveedores' + (id ? '/' + id : ''), {...this.draft,productIds:this.ids});
      if (saved?.id) this.selectedId = saved.id;
      this.draft = null;
      await this.load();
    } catch (error) { this.message = errorText(error); }
    finally { this.busy = false; }
  }
}
