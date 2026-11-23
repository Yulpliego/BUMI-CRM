import { Component, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, currency, dateInput, dateText, errorText, PartyOption } from './api';

interface Segment { segment: string; prospects: number; cost: number; costPerProspect: number; quotes: number; sales: number; revenue: number; }
interface ChannelSummary {channel:string; prospects:number; costPerProspect:number|null; quotations:number; sales:number; revenue:number;}
interface Origin { campaignId: number; partyId: number; name: string; segment: string; source: string; cost: number; capturedOn: string; }
interface CampaignReport { campaign: { id: number; name: string; channel: string; segment: string; start: string; end: string; }; segments: Segment[]; }
@Component({
  selector: 'bumi-attribution', imports: [FormsModule], template: `
    <details class="panel padded improvement" #panel (toggle)="panel.open && load()">
      <summary>Atribución comercial por campaña</summary>
      <p class="muted">Cada ficha tiene una campaña de origen. El informe atribuye las cotizaciones y ventas vigentes registradas a partir de la fecha de captación.</p>
      @if (message) {<p class="error" role="alert">{{message}}</p>}
      @if (channels.length) {
        <div class="table-scroll"><table><thead><tr><th>Canal</th><th>Captados</th><th>Costo por prospecto</th><th>Cotizaciones</th><th>Ventas</th><th>Importe</th></tr></thead>
        <tbody>@for (item of channels; track item.channel) {
          <tr><td>{{item.channel}}</td><td>{{item.prospects}}</td><td>{{item.costPerProspect === null ? '—' : money.format(item.costPerProspect)}}</td>
            <td>{{item.quotations}}</td><td>{{item.sales}}</td><td>{{money.format(item.revenue)}}</td></tr>
        }</tbody></table></div>
      }
      <label>Campaña<select [(ngModel)]="selected" (ngModelChange)="reset()">
        <option [ngValue]="0">Selecciona una campaña</option>
        @for (row of reports; track row.campaign.id) {<option [ngValue]="row.campaign.id">{{row.campaign.name}} · {{row.campaign.channel}}</option>}
      </select></label>
      @if (current(); as row) {
        <div class="table-scroll"><table><thead><tr><th>Segmento</th><th>Prospectos captados</th><th>Costo por prospecto</th><th>Cotizaciones</th><th>Ventas</th><th>Importe atribuido</th></tr></thead>
        <tbody>@for (item of row.segments; track item.segment) {<tr><td>{{item.segment}}</td><td>{{item.prospects}}</td><td>{{money.format(item.costPerProspect)}}</td><td>{{item.quotes}}</td><td>{{item.sales}}</td><td>{{money.format(item.revenue)}}</td></tr>}
        @empty {<tr><td colspan="6">Aún no se registró captación para esta campaña.</td></tr>}</tbody></table></div>
        @if (canWrite) {
          <form class="form-grid" (ngSubmit)="save()">
            <label>Ficha del público<select name="party" [(ngModel)]="draft.partyId" (ngModelChange)="fill()">
              <option [ngValue]="0">Selecciona una ficha</option>
              @for (item of audience(); track item.id) {<option [ngValue]="item.id">{{item.name}}</option>}
            </select></label>
            <label>Fecha de captación<input name="date" type="date" [(ngModel)]="draft.capturedOn" [min]="row.campaign.start" [max]="row.campaign.end" required></label>
            <label>Fuente de captación<input name="source" [(ngModel)]="draft.source" maxlength="100" required></label>
            <label>Segmento<input name="segment" [(ngModel)]="draft.segment" maxlength="100" required></label>
            <label>Costo de captar esta ficha en MXN<input name="cost" type="number" min="0" step=".01" [(ngModel)]="draft.cost" required></label>
            <div class="form-actions"><button class="primary" [disabled]="busy || !draft.partyId">Guardar captación</button></div>
          </form>
        }
        @for (item of contactsForCampaign(); track item.partyId) {
          <div class="report-row"><span>{{item.name}} · {{item.source}} · {{date(item.capturedOn)}}</span><strong>{{money.format(item.cost)}}</strong></div>
        }
      }
    </details>
  `
})
export class AttributionTools {
  api = inject(Api);
  audiences = input.required<{id:number; audience?:{id:number; name:string}[]}[]>();
  changed = output<void>();
  reports: CampaignReport[] = [];
  channels: ChannelSummary[] = [];
  contacts: Origin[] = [];
  draft = {partyId:0, source:'', segment:'', cost:0, capturedOn:''};
  selected = 0;
  busy = false;
  message = '';
  money = currency;
  date = dateText;
  get canWrite() { return ['Administrador','Marketing'].includes(this.api.profile()?.role ?? ''); }
  current() { return this.reports.find(item => item.campaign.id === this.selected); }
  audience() { return this.audiences().find(x => x.id === this.selected)?.audience ?? []; }
  contactsForCampaign() { return this.contacts.filter(x => x.campaignId === this.selected); }
  reset() {
    const campaign = this.current()?.campaign;
    const today = dateInput();
    this.draft = {partyId:0, source:campaign?.channel ?? '', segment:campaign?.segment ?? '', cost:0,
      capturedOn:campaign && campaign.end < today ? campaign.end : today};
  }
  fill() {
    const row = this.contacts.find(x => x.partyId === this.draft.partyId && x.campaignId === this.selected);
    if (row) this.draft = {...row};
  }
  async load() {
    try {
      const data = await this.api.get<{report: CampaignReport[]; contacts: Origin[]; channels: ChannelSummary[]}>('marketing/atribucion');
      this.reports = data.report;
      this.contacts = data.contacts;
      this.channels = data.channels;
    } catch (error) { this.message = errorText(error); }
  }
  async save() {
    if (this.busy) return;
    this.busy = true;
    this.message = '';
    try {
      await this.api.send('PUT', 'marketing/' + this.selected + '/origen', this.draft);
      await this.load();
      this.reset();
      this.changed.emit();
    } catch (error) { this.message = errorText(error); }
    finally { this.busy = false; }
  }
}

@Component({
  selector: 'bumi-duplicates', imports: [FormsModule], template: `
    <details class="panel padded improvement" #panel (toggle)="panel.open && scan()">
      <summary>Revisar duplicados</summary>
      <p class="muted">Compara correo, teléfono y RFC. Una fusión conserva esta ficha y mueve los registros relacionados de la ficha duplicada.</p>
      <button type="button" class="secondary" (click)="scan()">Buscar coincidencias</button>
      @if (message) {<p class="error" role="alert">{{message}}</p>}
      @if (done) {<p class="notice" role="status">{{done}}</p>}
      @for (row of rows; track row.id) {
        <div class="report-row"><span>{{row.name}} · {{row.kind}} · {{row.matches.join(', ')}}</span>
        @if (api.manager && party().id && (row.kind !== 'Cliente' || party().kind === 'Cliente')) {
          <button type="button" class="text-button" (click)="source = row.id">Revisar fusión</button>
        }</div>
      } @empty { @if (searched) {<p class="muted">Sin coincidencias con estos datos.</p>} }
      @if (source; as candidate) {
        <div class="stack">
          <label>Motivo para incorporar la ficha #{{candidate}}<input [(ngModel)]="reason" [ngModelOptions]="{standalone:true}" maxlength="300"></label>
          <div class="actions"><button type="button" class="primary" [disabled]="busy || !reason.trim()" (click)="merge()">Confirmar fusión en {{party().name}}</button>
          <button type="button" class="secondary" (click)="source = 0">Cancelar</button></div>
        </div>
      }
    </details>
  `
})
export class DuplicateTools {
  api = inject(Api);
  party = input.required<{id:number; name:string; kind:string; email?:string; phone?:string; rfc?:string}>();
  merged = output<void>();
  rows: (PartyOption & {matches:string[]})[] = [];
  message = '';
  done = '';
  source = 0;
  reason = '';
  busy = false;
  searched = false;
  async scan() {
    this.message = '';
    const data = this.party();
    const params = new URLSearchParams({correo:data.email ?? '', telefono:data.phone ?? '', rfc:data.rfc ?? '', excluir:String(data.id)});
    try { this.rows = await this.api.get<typeof this.rows>('clientes/duplicados?' + params); this.searched = true; }
    catch (error) { this.message = errorText(error); }
  }
  async merge() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.api.send('POST', 'clientes/' + this.party().id + '/fusion', {sourceId:this.source, reason:this.reason});
      this.source = 0;
      this.reason = '';
      this.done = 'Fusión registrada. Se incorporaron los registros relacionados.';
      this.merged.emit();
      await this.scan();
    } catch (error) { this.message = errorText(error); }
    finally { this.busy = false; }
  }
}

@Component({
  selector: 'bumi-opportunity-actions', imports: [RouterLink], template: `
    <details class="panel padded improvement" #panel (toggle)="panel.open && load()">
      <summary>Siguientes acciones sugeridas</summary>
      @if (message) {<p class="error" role="alert">{{message}}</p>}
      @for (row of rows; track row.id) {
        <div class="report-row"><div><strong>{{row.name}} · {{row.description}}</strong><small>{{row.reason}} · {{money.format(row.value)}}</small></div>
          @if (api.enabled('agenda')) {<a class="secondary button" routerLink="/agenda" [queryParams]="{nueva:1,ficha:row.partyId,oportunidad:row.id}">Agendar</a>}</div>
      } @empty { <p class="muted">Sin seguimientos pendientes para las reglas actuales.</p> }
    </details>
  `
})
export class OpportunityActions {
  api = inject(Api);
  money = currency;
  rows: {id:number; partyId:number; name:string; description:string; reason:string; value:number}[] = [];
  message = '';
  async load() {
    try { this.rows = await this.api.get<typeof this.rows>('clientes/oportunidades/sugerencias'); }
    catch (error) { this.message = errorText(error); }
  }
}
