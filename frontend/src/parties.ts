import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, currency, dateText, errorText, PartyOption } from './api';

interface Party extends PartyOption {
  personType: string; contact: string; email: string; phone: string; source: string;
  rfc: string; industry: string; address: string; stage: string; active: boolean;
}
interface Contact { id: number; name: string; position: string; email: string; phone: string; }
interface Opportunity { id: number; description: string; interest: string; value: number; expectedClose: string | null; stage: string; }
interface Details { party: Party; contacts: Contact[]; opportunities: Opportunity[]; }

@Component({
  imports: [FormsModule],
  template: `
    <header class="page-head"><div><p class="eyebrow">RELACIONES COMERCIALES</p><h1>Clientes y prospectos</h1><p>Consulta y administra tu cartera, contactos y oportunidades.</p></div>
      <button class="primary" (click)="newParty()">+ Nuevo registro</button></header>
    @if (notice) { <p class="notice" role="status">{{notice}}</p> }
    @if (message) { <p class="error" role="alert">{{message}}</p> }

    @if (edit; as p) {
      <section class="panel padded editor">
        <header class="section-head"><h2>{{p.id ? 'Editar ficha' : 'Nuevo registro'}}</h2><button type="button" class="secondary" (click)="edit = null">Cerrar</button></header>
        <form class="form-grid" (ngSubmit)="saveParty()">
          <label>Tipo de registro<select name="kind" [(ngModel)]="p.kind" [disabled]="!!p.id"><option>Prospecto</option><option>Cliente</option></select></label>
          <label>Tipo de persona<select name="personType" [(ngModel)]="p.personType"><option>Empresa</option><option>Persona física</option></select></label>
          <label>Nombre o razón social<input name="name" [(ngModel)]="p.name" required maxlength="150"></label>
          <label>Persona de contacto<input name="contact" [(ngModel)]="p.contact" maxlength="120"></label>
          <label>Correo<input type="email" name="email" [(ngModel)]="p.email" maxlength="160"></label>
          <label>Teléfono<input type="tel" name="phone" [(ngModel)]="p.phone" maxlength="35"></label>
          <label>RFC<input name="rfc" [(ngModel)]="p.rfc" maxlength="13"></label>
          <label>Giro<input name="industry" [(ngModel)]="p.industry" maxlength="100"></label>
          <label class="wide">Dirección<input name="address" [(ngModel)]="p.address" maxlength="250"></label>
          @if (p.kind === 'Prospecto') {
            <label>Origen<input name="source" [(ngModel)]="p.source" placeholder="Ej. Referido" maxlength="80"></label>
            <label>Seguimiento<select name="stage" [(ngModel)]="p.stage">@for (stage of leadStages; track stage) {<option>{{stage}}</option>}</select></label>
          }
          <label class="check"><input type="checkbox" name="active" [(ngModel)]="p.active"> Registro activo</label>
          <div class="form-actions wide"><button class="primary" [disabled]="busy">Guardar registro</button></div>
        </form>
      </section>
    }

    @if (details; as d) {
      <section class="panel padded editor">
        <header class="section-head"><div><h2>{{d.party.name}}</h2><p>{{d.party.kind}} · {{d.party.personType}} · {{d.party.active ? 'Activo' : 'Inactivo'}}</p></div>
          <div class="actions">
            <button class="secondary" (click)="beginEdit(d.party)">Editar</button>
            @if (d.party.kind === 'Prospecto' && d.party.active) {
              <button class="primary" (click)="convert(d.party.id)" [disabled]="busy">Convertir en cliente</button>
            }
            <button class="secondary" (click)="closeDetails()">Cerrar ficha</button>
          </div>
        </header>
        <div class="detail-facts">
          <div><small>Contacto principal</small><b>{{d.party.contact || '—'}}</b></div><div><small>Correo</small><b>{{d.party.email || '—'}}</b></div>
          <div><small>Teléfono</small><b>{{d.party.phone || '—'}}</b></div><div><small>RFC</small><b>{{d.party.rfc || '—'}}</b></div>
          <div><small>Giro</small><b>{{d.party.industry || '—'}}</b></div><div><small>Dirección</small><b>{{d.party.address || '—'}}</b></div>
          @if (d.party.source) {<div><small>Origen</small><b>{{d.party.source}}</b></div>}
        </div>
        <div class="detail-columns">
          <div>
            <header class="section-head"><h3>Contactos</h3>@if (d.party.active) {<button class="text-button" (click)="newContact()">+ Agregar</button>}</header>
            @for (contact of d.contacts; track contact.id) {
              <div class="report-row"><div><b>{{contact.name}}</b><small>{{contact.position}} {{contact.email}} {{contact.phone}}</small></div></div>
            } @empty {<p class="empty">Aún no hay contactos adicionales.</p>}
            @if (contactEdit; as c) {
              <form class="stack subform" (ngSubmit)="saveContact(d.party.id)">
                <label>Nombre<input name="contactName" [(ngModel)]="c.name" maxlength="120" required></label>
                <label>Cargo<input name="position" [(ngModel)]="c.position" maxlength="80"></label>
                <label>Correo<input type="email" name="contactEmail" [(ngModel)]="c.email" maxlength="160"></label>
                <label>Teléfono<input name="contactPhone" [(ngModel)]="c.phone" maxlength="35"></label>
                <div class="actions"><button class="primary" [disabled]="busy">Guardar contacto</button><button type="button" class="secondary" (click)="contactEdit = null">Cancelar</button></div>
              </form>
            }
          </div>
          <div>
            <header class="section-head"><h3>Oportunidades</h3>@if (d.party.active) {<button class="text-button" (click)="newOpportunity()">+ Agregar</button>}</header>
            @for (o of d.opportunities; track o.id) {
              <div class="report-row"><div><b>{{o.description}}</b><small>{{o.stage}} · {{money.format(o.value)}} · {{date(o.expectedClose || '')}}</small></div>
                @if (d.party.active) {<button class="text-button" (click)="opportunityEdit = {...o}">Editar</button>}</div>
            } @empty {<p class="empty">Aún no hay oportunidades registradas.</p>}
            @if (opportunityEdit; as o) {
              <form class="stack subform" (ngSubmit)="saveOpportunity(d.party.id)">
                <label>Descripción<input name="description" [(ngModel)]="o.description" required maxlength="250"></label>
                <label>Producto o servicio de interés<input name="interest" [(ngModel)]="o.interest" maxlength="150"></label>
                <label>Valor estimado (MXN)<input type="number" name="value" [(ngModel)]="o.value" min="0" step="0.01" required></label>
                <label>Cierre estimado<input type="date" name="close" [(ngModel)]="o.expectedClose"></label>
                <label>Etapa<select name="opportunityStage" [(ngModel)]="o.stage">@for (stage of stages; track stage) {<option>{{stage}}</option>}</select></label>
                <div class="actions"><button class="primary" [disabled]="busy">Guardar oportunidad</button><button type="button" class="secondary" (click)="opportunityEdit = null">Cancelar</button></div>
              </form>
            }
          </div>
        </div>
      </section>
    }

    <section class="panel table-panel">
      <div class="table-head"><div class="tabs" aria-label="Tipos de ficha">
        @for (filter of types; track filter.value) {
          <button [class.current]="type === filter.value" [attr.aria-pressed]="type === filter.value" (click)="type = filter.value">{{filter.text}}</button>
        }
      </div><label class="sr-only" for="party-search">Buscar registros</label><input class="search" id="party-search" type="search" [(ngModel)]="search" placeholder="Buscar por nombre o correo"></div>
      <div class="table-scroll"><table>
        <thead><tr><th>Nombre</th><th>Tipo</th><th>Contacto</th><th>Estado</th><th><span class="sr-only">Acciones</span></th></tr></thead>
        <tbody>
          @for (item of filtered(); track item.id) {
            <tr><td><strong>{{item.name}}</strong><small>{{item.industry || item.source || item.personType}}</small></td>
              <td>{{item.kind}}</td><td>{{item.contact || '—'}}<small>{{item.email}}</small></td>
              <td><span class="badge" [attr.data-status]="item.active ? (item.kind === 'Cliente' ? 'Activo' : item.stage) : 'Inactivo'">{{item.active ? (item.kind === 'Cliente' ? 'Activo' : item.stage) : 'Inactivo'}}</span></td>
              <td><button class="text-button" (click)="openDetails(item.id)">Ver ficha</button></td></tr>
          } @empty {<tr><td colspan="5" class="empty">{{loading ? 'Cargando registros…' : 'No hay registros para mostrar.'}}</td></tr>}
        </tbody>
      </table></div>
    </section>
  `
})
export class PartiesPage {
  api = inject(Api);
  money = currency;
  date = dateText;
  rows: Party[] = [];
  details: Details | null = null;
  edit: Party | null = null;
  contactEdit: Omit<Contact, 'id'> | null = null;
  opportunityEdit: Opportunity | null = null;
  message = '';
  notice = '';
  busy = false;
  loading = true;
  search = '';
  type = '';
  types = [{ value: '', text: 'Todos' }, { value: 'Cliente', text: 'Clientes' }, { value: 'Prospecto', text: 'Prospectos' }];
  leadStages = ['Nuevo', 'En seguimiento', 'Calificado', 'No calificado'];
  stages = ['Nueva', 'En seguimiento', 'Propuesta', 'Negociación', 'Ganada', 'Perdida'];

  ngOnInit() { void this.load(); }
  async load() {
    try { this.rows = await this.api.get<Party[]>('clientes'); }
    catch (error) { this.message = errorText(error); }
    finally { this.loading = false; }
  }
  filtered() {
    const q = this.search.trim().toLocaleLowerCase('es-MX');
    return this.rows.filter(x => (!this.type || x.kind === this.type) &&
      [x.name, x.contact, x.email].some(value => value.toLocaleLowerCase('es-MX').includes(q)));
  }
  newParty() {
    this.resetFeedback();
    this.edit = {id: 0, name: '', kind: this.type || 'Prospecto', personType: 'Empresa', contact: '', email: '',
      phone: '', source: '', rfc: '', industry: '', address: '', stage: 'Nuevo', active: true};
  }
  beginEdit(p: Party) { this.resetFeedback(); this.edit = {...p}; }
  closeDetails() { this.details = this.contactEdit = this.opportunityEdit = null; }
  newContact() { this.contactEdit = {name: '', position: '', email: '', phone: ''}; }
  newOpportunity() { this.opportunityEdit = {id: 0, description: '', interest: '', value: 0, expectedClose: null, stage: 'Nueva'}; }
  resetFeedback() { this.message = this.notice = ''; }

  async openDetails(id: number) {
    this.resetFeedback();
    this.closeDetails();
    try {
      this.details = await this.api.get<Details>('clientes/' + id + '/detalle');
      window.scrollTo({top: 0, behavior: 'smooth'});
    } catch (error) { this.message = errorText(error); }
  }

  async saveParty() {
    if (!this.edit) return;
    const record = this.edit;
    await this.mutate(record.id ? 'PUT' : 'POST', 'clientes' + (record.id ? '/' + record.id : ''), record,
      'Registro guardado.', this.details?.party.id === record.id ? record.id : undefined);
    if (!this.message) this.edit = null;
  }
  async convert(id: number) {
    await this.mutate('POST', 'clientes/' + id + '/convertir', {}, 'Prospecto convertido en cliente.', id);
  }
  async saveContact(id: number) {
    await this.mutate('POST', 'clientes/' + id + '/contactos', this.contactEdit, 'Contacto agregado.', id);
    if (!this.message) this.contactEdit = null;
  }
  async saveOpportunity(id: number) {
    if (!this.opportunityEdit) return;
    const record = this.opportunityEdit;
    await this.mutate(record.id ? 'PUT' : 'POST', 'clientes/' + id + '/oportunidades' + (record.id ? '/' + record.id : ''),
      {...record, expectedClose: record.expectedClose || null}, 'Oportunidad guardada.', id);
    if (!this.message) this.opportunityEdit = null;
  }
  private async mutate(method: string, path: string, input: unknown, success: string, detailId?: number) {
    if (this.busy) return;
    this.busy = true;
    this.resetFeedback();
    try {
      await this.api.send(method, path, input);
      if (detailId) this.details = await this.api.get<Details>('clientes/' + detailId + '/detalle');
      await this.load();
      this.notice = success;
    } catch (error) { this.message = errorText(error); }
    finally { this.busy = false; }
  }
}
