import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, dateInput, dateText, errorText, PartyOption } from './api';

interface Campaign {
  id: number; name: string; goal: string; description: string; channel: string; segment: string;
  status: string; start: string; end: string; reached: number; leads: number; owner: string; audienceIds: number[];
}

@Component({
  imports: [FormsModule],
  template: `
    <header class="page-head"><div><p class="eyebrow">DEMANDA Y PROSPECCIÓN</p><h1>Marketing</h1><p>Organiza campañas, sus públicos y los resultados obtenidos.</p></div>
      @if (canEdit) {<button class="primary" (click)="newCampaign()">+ Nueva campaña</button>}</header>
    @if (notice) {<p class="notice" role="status">{{notice}}</p>}
    @if (message) {<p class="error" role="alert">{{message}}</p>}

    @if (edit; as c) {
      <section class="panel padded editor">
        <header class="section-head"><h2>{{c.id ? 'Editar campaña' : 'Nueva campaña'}}</h2><button class="secondary" (click)="edit = null">Cerrar</button></header>
        <form class="form-grid" (ngSubmit)="save()">
          <label>Nombre<input name="name" [(ngModel)]="c.name" maxlength="150" required></label>
          <label>Objetivo<input name="goal" [(ngModel)]="c.goal" maxlength="200" required></label>
          <label>Canal<select name="channel" [(ngModel)]="c.channel">@for (value of channels; track value) {<option>{{value}}</option>}</select></label>
          <label>Público objetivo<input name="segment" [(ngModel)]="c.segment" maxlength="150"></label>
          <label>Fecha de inicio<input type="date" name="start" [(ngModel)]="c.start" required></label>
          <label>Fecha de fin<input type="date" name="end" [(ngModel)]="c.end" [min]="c.start" required></label>
          <label>Estado<select name="status" [(ngModel)]="c.status">@for (value of statuses; track value) {<option>{{value}}</option>}</select></label>
          <label>Contactos realizados<input type="number" name="reached" [(ngModel)]="c.reached" min="0" step="1" required></label>
          <label>Prospectos obtenidos<input type="number" name="leads" [(ngModel)]="c.leads" min="0" step="1" required></label>
          <label class="wide">Descripción<textarea name="description" [(ngModel)]="c.description" maxlength="500" rows="3"></textarea></label>
          <fieldset class="wide audience"><legend>Clientes y prospectos asociados</legend>
            @for (person of audience; track person.id) {
              <label class="check"><input type="checkbox" [checked]="c.audienceIds.includes(person.id)" (change)="setAudience(person.id, $event)">{{person.name}} <small>{{person.kind}}</small></label>
            } @empty {<p class="empty">Aún no hay registros disponibles.</p>}
          </fieldset>
          <div class="form-actions wide"><button class="primary" [disabled]="busy">Guardar campaña</button></div>
        </form>
      </section>
    }
    <div class="campaign-grid">
      @for (c of campaigns; track c.id) {
        <article class="panel padded campaign">
          <div class="section-head"><span class="campaign-channel">{{c.channel}}</span><span class="badge" [attr.data-status]="c.status">{{c.status}}</span></div>
          <h2>{{c.name}}</h2><p>{{c.goal}}</p>
          @if (c.description) {<p class="muted">{{c.description}}</p>}
          <div class="campaign-results"><div><strong>{{c.reached}}</strong><small>Contactos</small></div>
            <div><strong>{{c.leads}}</strong><small>Prospectos</small></div>
            <div><strong>{{c.audienceIds.length}}</strong><small>Asociados</small></div></div>
          <div class="campaign-footer"><div><b>{{c.segment || 'Público general'}}</b><small>{{date(c.start)}} – {{date(c.end)}} · {{c.owner}}</small></div>
            @if (canEdit) {<button class="text-button" (click)="beginEdit(c)">Editar</button>}</div>
        </article>
      } @empty {<p class="panel padded empty">{{loading ? 'Cargando campañas…' : 'Aún no hay campañas registradas.'}}</p>}
    </div>
  `
})
export class MarketingPage {
  api = inject(Api);
  date = dateText;
  campaigns: Campaign[] = [];
  audience: PartyOption[] = [];
  edit: Campaign | null = null;
  busy = false;
  loading = true;
  message = '';
  notice = '';
  channels = ['Email', 'Eventos', 'Redes sociales', 'Teléfono', 'Otro'];
  statuses = ['Planeada', 'Activa', 'Finalizada', 'Pausada'];
  get canEdit() { return ['Administrador', 'Marketing'].includes(this.api.profile()?.role || ''); }

  ngOnInit() { void this.load(); }
  async load() {
    try {
      const [campaigns, audience] = await Promise.all([
        this.api.get<Campaign[]>('marketing'),
        this.canEdit ? this.api.get<PartyOption[]>('marketing/publico') : Promise.resolve([])
      ]);
      this.campaigns = campaigns;
      this.audience = audience;
    } catch (error) { this.message = errorText(error); }
    finally { this.loading = false; }
  }
  newCampaign() {
    this.beginEdit({id: 0, name: '', goal: '', description: '', channel: 'Email', segment: '', status: 'Planeada',
      start: dateInput(), end: dateInput(14), reached: 0, leads: 0, owner: '', audienceIds: []});
  }
  beginEdit(campaign: Campaign) {
    this.edit = {...campaign, audienceIds: [...campaign.audienceIds]};
    this.message = this.notice = '';
    window.scrollTo({top: 0, behavior: 'smooth'});
  }
  setAudience(id: number, event: Event) {
    if (!this.edit) return;
    const selected = (event.target as HTMLInputElement).checked;
    this.edit.audienceIds = selected ? [...this.edit.audienceIds, id] : this.edit.audienceIds.filter(item => item !== id);
  }
  async save() {
    if (!this.edit || this.busy) return;
    this.busy = true;
    this.message = this.notice = '';
    try {
      const id = this.edit.id;
      await this.api.send(id ? 'PUT' : 'POST', 'marketing' + (id ? '/' + id : ''), this.edit);
      this.edit = null;
      this.notice = 'Campaña guardada.';
      await this.load();
    } catch (error) { this.message = errorText(error); }
    finally { this.busy = false; }
  }
}
