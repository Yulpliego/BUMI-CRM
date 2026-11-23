import { Component, effect, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api, currency, dateText, errorText, folio } from './api';

interface Replenishment {
  id:number; sku:string; name:string; stock:number; minimum:number; coverageDays:number|null; recentStockoutDays:number|null; previousStockoutDays:number|null;
  incoming:number; dailyDemand:number; suggestedQuantity:number; suggestedOn:string|null; leadDays:number|null; supplier:string|null;
}
@Component({
  selector:'bumi-replenishment', imports:[RouterLink, FormsModule], styleUrl:'./replenishment.css', template:`
    <section class="panel replenishment" aria-labelledby="replenishment-heading">
      <header>
        <div><h2 id="replenishment-heading">Cobertura y reposición</h2><p>Productos que requieren atención según existencias, demanda y compras en camino.</p></div>
        @if (api.enabled('proveedores')) {
          <a class="primary button" routerLink="/proveedores" [queryParams]="{ordenes:1}">Revisar órdenes de compra</a>
        }
      </header>
      @if (message) {<p class="error" role="alert">{{message}} <button class="text-button" type="button" (click)="load()">Reintentar</button></p>}
      @if (loading) {<p class="muted" role="status">Calculando reposición…</p>}
      @else if (!message) {
        <div class="replenishment-cards">
          @for (row of priority(); track row.id) {
            <article>
              <strong>{{row.name}} <small>{{row.sku}}</small></strong>
              <span class="replenishment-days">{{row.coverageDays === null ? 'Sin ventas recientes' : row.coverageDays + ' días de cobertura'}}</span>
              <p>Reponer <b>{{row.suggestedQuantity}} unidades</b></p>
              @if (row.suggestedOn) { <small>{{date(row.suggestedOn)}} · {{row.supplier}}</small> }
              @else { <small>Falta configurar un proveedor para estimar la fecha.</small> }
              @if (api.enabled('proveedores')) {
                <a class="text-button" routerLink="/proveedores" [queryParams]="{reponer:row.id,cantidad:row.suggestedQuantity}">Comparar proveedores</a>
              }
            </article>
          } @empty { <p class="muted">No hay productos con reposición sugerida.</p> }
        </div>
        <details class="replenishment-details">
          <summary>Ver cálculo y cobertura por producto</summary>
          <p>Usa las ventas netas de 60 días y compara los días sin existencias de los dos últimos periodos de 30 días. La compra sugerida considera el mínimo, el plazo del proveedor, 14 días de cobertura adicional y las compras aprobadas.</p>
          <label class="check"><input type="checkbox" [(ngModel)]="onlySuggested"> Solo productos con reposición sugerida</label>
          <div class="table-scroll" tabindex="0" aria-label="Cobertura y reposición por SKU">
            <table><thead><tr><th>Producto</th><th>Existencias</th><th>Demanda diaria</th><th>Cobertura</th><th>Días sin stock</th><th>Reposición</th></tr></thead>
              <tbody>@for (row of visible(); track row.id) {
                <tr><td>{{row.name}}<small>{{row.sku}}</small></td><td>{{row.stock}}<small>{{row.incoming}} en camino</small></td><td>{{row.dailyDemand}}</td>
                  <td>{{row.coverageDays === null ? 'Sin ventas recientes' : row.coverageDays + ' días'}}</td><td>{{row.recentStockoutDays ?? 'Sin historial'}}<small>Periodo anterior · {{row.previousStockoutDays ?? 'Sin historial'}}</small></td>
                  <td>{{row.suggestedQuantity}} unidades
                    @if (row.suggestedOn) {<small>{{date(row.suggestedOn)}} · {{row.supplier}} · {{row.leadDays}} días</small>}
                    @if (row.suggestedQuantity > 0 && api.enabled('proveedores')) {<a routerLink="/proveedores" [queryParams]="{reponer:row.id,cantidad:row.suggestedQuantity}">Revisar compra</a>}
                  </td></tr>
              } @empty {<tr><td colspan="6">Sin coincidencias para esta vista.</td></tr>}</tbody>
            </table>
          </div>
        </details>
      }
    </section>
  `
})

export class ReplenishmentPanel {
  api = inject(Api);
  readonly revision = input(0);
  loading = true;
  private request = 0;
  constructor() {
    effect(() => { this.revision(); void this.load(); });
  }
  date = dateText;
  onlySuggested = true;
  data: Replenishment[] = [];
  message = '';
  visible() { return this.onlySuggested ? this.data.filter(x=> x.suggestedQuantity > 0) : this.data; }
  priority() { return this.data.filter(item => item.suggestedQuantity > 0).slice(0,4); }
  async load() {
    const request = ++this.request;
    this.loading = true;
    this.message = '';
    try {
      const result = await this.api.get<Replenishment[]>('inventario/reposicion');
      if (request === this.request) this.data = result;
    } catch (error) { if (request === this.request) this.message = errorText(error); }
    finally { if (request === this.request) this.loading = false; }
  }
}

interface Offer {supplierId:number; supplier:string; cost:number; leadDays:number; total:number; received:number; onTime:number; overdue:number;}
interface Purchase {id:number; supplier:string; product:string; quantity:number; unitCost:number; due:string; received:string|null; status:string;}
@Component({
  selector:'bumi-purchasing', imports:[FormsModule], template:`
    <details class="panel padded improvement" open #panel (toggle)="panel.open && reload()">
      <summary>Comparación, condiciones y órdenes de compra</summary>
      <p class="muted">Compara costo, fecha estimada y entregas registradas. Las órdenes quedan en borrador hasta que Compras o Administración las aprueba.</p>
      @if (message) {<p class="error" role="alert">{{message}}</p>}
      @if (canEdit()) {
        <form class="form-grid" (ngSubmit)="setTerms()">
          <label>Proveedor<select name="supplier" [(ngModel)]="term.supplierId"><option [ngValue]="0">Selecciona</option>
            @for (item of suppliers(); track item.id) { @if (item.active) {<option [ngValue]="item.id">{{item.name}}</option>} }
          </select></label>
          <label>Producto vinculado<select name="product" [(ngModel)]="term.productId"><option [ngValue]="0">Selecciona</option>
            @for (item of supplierProducts(); track item.id) {<option [ngValue]="item.id">{{item.name}}</option>}</select></label>
          <label>Costo unitario MXN<input name="cost" type="number" min=".01" step=".01" [(ngModel)]="term.cost" required></label>
          <label>Plazo de entrega en días<input name="days" type="number" min="1" max="365" [(ngModel)]="term.leadDays" required></label>
          <div class="form-actions"><button class="primary" [disabled]="busy || !term.supplierId || !term.productId">Guardar condiciones</button></div>
        </form>
      }
      <form class="filters" (ngSubmit)="compare()">
        <label>Artículo a comparar<select name="compareProduct" [(ngModel)]="product"><option [ngValue]="0">Selecciona</option>
          @for (item of catalog(); track item.id) {<option [ngValue]="item.id">{{item.name}}</option>}</select></label>
        <label>Unidades<input name="quantity" type="number" min="1" max="1000000" [(ngModel)]="amount" required></label>
        <button class="secondary" [disabled]="busy || !product">Comparar proveedores</button>
      </form>
      @if (compared) {
        <div class="table-scroll"><table><thead><tr><th>Proveedor</th><th>Costo total</th><th>Plazo</th><th>Puntualidad</th><th>Vencidas</th><th></th></tr></thead>
        <tbody>@for (item of offers; track item.supplierId) {
          <tr><td>{{item.supplier}} @if ($first && offers.length > 1) {<small class="badge">Menor costo</small>}</td>
          <td>{{money.format(item.total)}}<small>{{money.format(item.cost)}} por unidad</small></td><td>{{item.leadDays}} días</td>
          <td>@if (item.received) {
            <meter min="0" max="100" [value]="punctuality(item)" aria-label="Porcentaje de recepciones a tiempo"></meter>
            <small>{{punctuality(item)}} % · {{item.onTime}} de {{item.received}}</small>
          } @else {Sin recepciones}</td><td>{{item.overdue}}</td>
          <td>@if (canEdit()) {<button type="button" class="text-button" [disabled]="busy || product !== compared || amount !== comparedAmount" (click)="draft(item)">Crear borrador</button>}</td></tr>
        } @empty {<tr><td colspan="6">El producto aún no tiene condiciones registradas.</td></tr>}</tbody></table></div>
      }
      <h3>Órdenes recientes</h3>
      @for (order of orders; track order.id) {
        <div class="report-row"><div><strong>{{code('OC',order.id)}} · {{order.product}}</strong>
          <small>{{order.supplier}} · {{order.quantity}} unidades · {{money.format(order.quantity*order.unitCost)}}</small>
          <small>{{order.status}} · Entrega prevista {{date(order.due)}} @if (order.received) { · Recibida {{date(order.received)}} }</small></div>
          @if (canEdit()) {<div class="actions">
            @if (order.status === 'Borrador') {<button class="secondary" [disabled]="busy" (click)="update(order,'Aprobada')">Aprobar</button>}
            @if (order.status === 'Aprobada') {<button class="primary" [disabled]="busy" (click)="update(order,'Recibida')">Registrar entrada</button>}
            @if (order.status === 'Borrador' || order.status === 'Aprobada') {<button class="text-button" [disabled]="busy" (click)="update(order,'Cancelada')">Cancelar</button>}
          </div>}
        </div>
      } @empty {<p class="muted">Todavía no hay órdenes de compra.</p>}
    </details>
  `
})
export class PurchasePanel {
  api = inject(Api);
  route = inject(ActivatedRoute);
  canEdit = input.required<boolean>();
  suppliers = input.required<{id:number; name:string; active:boolean; products:{id:number; name:string; active:boolean}[]}[]>();
  catalog = input.required<{id:number; name:string}[]>();
  initial = Number(this.route.snapshot.queryParamMap.get('reponer') || 0);
  product = this.initial;
  amount = Math.max(1, Number(this.route.snapshot.queryParamMap.get('cantidad')) || 1);
  compared = 0;
  comparedAmount = 0;
  term = {supplierId:0, productId:0, cost:0, leadDays:7};
  offers: Offer[] = [];
  orders: Purchase[] = [];
  busy = false;
  message = '';
  money = currency;
  date = dateText;
  code = folio;
  supplierProducts() { return this.suppliers().find(x=>x.id===this.term.supplierId)?.products.filter(x=>x.active) ?? []; }
  async reload() {
    try {
      this.orders = await this.api.get<Purchase[]>('proveedores/ordenes');
      if (this.initial && !this.compared) await this.compare();
    } catch (error) { this.message = errorText(error); }
  }
  punctuality(offer: Offer) { return Math.round(offer.onTime / offer.received * 100); }
  async compare() {
    const id = this.product;
    const quantity = this.amount;
    if (!id) return;
    try {
      this.offers = await this.api.get<Offer[]>('proveedores/comparar?producto='+id+'&cantidad='+quantity);
      this.compared = id;
      this.comparedAmount = quantity;
    } catch (error) { this.message = errorText(error); }
  }
  async setTerms() {
    await this.mutate('PUT','proveedores/condiciones',this.term);
    if (this.compared === this.term.productId) await this.compare();
  }
  async draft(offer:Offer) {
    if (this.product !== this.compared || this.amount !== this.comparedAmount) return;
    await this.mutate('POST','proveedores/ordenes',{supplierId:offer.supplierId,productId:this.product,quantity:this.amount});
  }
  async update(order:Purchase, status:string) {
    await this.mutate('PUT','proveedores/ordenes/'+order.id+'/estado',{status});
    if (this.compared) await this.compare();
  }
  private async mutate(method:string,path:string,body:unknown) {
    if (this.busy) return;
    this.busy = true;
    this.message = '';
    try { await this.api.send(method,path,body); await this.reload(); }
    catch (error) { this.message = errorText(error); }
    finally { this.busy = false; }
  }
}
