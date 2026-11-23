import { Component, effect, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, dateText, errorText } from './api';

@Component({
  selector:'bumi-priorities', imports:[RouterLink], template:`
    <section class="panel padded improvement">
      <header class="section-head"><div><h2>Prioridades de hoy</h2><p>{{data?.resolved ?? 0}} actividades vencidas resueltas en los últimos 7 días.</p></div></header>
      @if (message) {<p class="error" role="alert">{{message}}</p>}
      @for (row of data?.items; track row.route + row.id) {
        <div class="report-row"><div><strong>{{row.title}}</strong><small>{{row.reason}}</small></div>
          <a class="secondary button" [routerLink]="row.route" [queryParams]="{id:row.id}">Revisar</a></div>
      } @empty { @if (data) {<p class="muted">No tienes pendientes en la cola de prioridades.</p>} }
    </section>
  `
})
export class PrioritiesPanel {
  api = inject(Api);
  data?: {resolved:number; items:{id:number; title:string; reason:string; route:string}[]};
  message = '';
  async ngOnInit() {
    try { this.data = await this.api.get<NonNullable<typeof this.data>>('inicio/prioridades'); }
    catch (error) { this.message = errorText(error); }
  }
}

interface Schedule {completed:number; onTime:number; resolvedLate:number; slots:string[];}
interface ScheduleChange {id:number; at:string; due:string; newDue:string|null; actor:string; reason:string; kind:string;}
@Component({
  selector:'bumi-schedule', template:`
    <details class="improvement" [open]="expanded()">
      <summary>Horarios sugeridos y seguimiento</summary>
      @if (message) {<p class="error" role="alert">{{message}}</p>}
      @if (data; as overview) {
        <p>{{overview.onTime}} a tiempo de {{overview.completed}} actividades completadas en siete días.</p>
        @if (interactive()) {
          <p class="muted">Los horarios priorizan los días con menos actividades. Usan horas hábiles de Ciudad de México.</p>
          <div class="actions">
            @for (item of overview.slots; track item) {<button type="button" class="secondary" (click)="suggested.emit(item)">{{format(item)}} · Usar</button>}
          </div>
        }
      }
      @for (event of changes; track event.id) {
        <div class="report-row"><div><strong>{{event.kind}} · {{event.actor}}</strong><small>{{event.reason}}</small>
          @if (event.newDue) {<small>{{format(event.due)}} → {{format(event.newDue)}}</small>}</div><span>{{format(event.at)}}</span></div>
      }
    </details>
  `
})
export class SchedulePanel {
  api = inject(Api);
  owner = input<number|null>();
  activity = input<number|null>();
  interactive = input(false);
  expanded = input(false);
  suggested = output<string>();
  data?:Schedule;
  changes:ScheduleChange[] = [];
  message = '';
  constructor() { effect(() => { this.owner(); this.activity(); void this.load(); }); }
  format(value:string) { return new Intl.DateTimeFormat('es-MX',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)); }
  async load() {
    const params = new URLSearchParams();
    const owner = this.owner();
    const activity = this.activity();
    if (owner) params.set('responsable',String(owner));
    if (activity) params.set('excluir',String(activity));
    try {
      const [data, changes] = await Promise.all([this.api.get<Schedule>('agenda/seguimiento?'+params),
        activity ? this.api.get<ScheduleChange[]>('agenda/'+activity+'/cambios') : Promise.resolve([])]);
      if (owner === this.owner() && activity === this.activity()) { this.data = data; this.changes = changes; }
    } catch (error) { this.message = errorText(error); }
  }
}

interface Preferences {quietFrom:number; quietUntil:number; escalationHours:number; priority:string;}
@Component({
  selector:'bumi-notice-preferences', imports:[FormsModule], template:`
    <details class="panel padded improvement" #panel (toggle)="panel.open && load()">
      <summary>Horario y prioridad de los avisos</summary>
      <p class="muted">El horario silencioso pausa el contador de avisos ordinarios en la barra superior. Los avisos siguen disponibles en la bandeja. Si las horas coinciden, el silencio queda desactivado.</p>
      @if (message) {<p class="error" role="alert">{{message}}</p>}
      @if (notice) {<p class="notice" role="status">{{notice}}</p>}
      @for (item of metrics; track item.group) {
        <div class="report-row"><span>{{item.group}} · {{item.read}} avisos leídos en siete días</span>
          @if (item.meanHours !== null) {<strong>{{hours.format(item.meanHours)}} h desde el vencimiento o escalamiento</strong>}</div>
      }
      @if (draft; as prefs) {
        <form class="form-grid" (ngSubmit)="save(prefs)">
          <label>Silencio desde (hora CDMX)<input name="from" type="number" min="0" max="23" [(ngModel)]="prefs.quietFrom" required></label>
          <label>Silencio hasta (hora CDMX)<input name="until" type="number" min="0" max="23" [(ngModel)]="prefs.quietUntil" required></label>
          <label>Grupo prioritario<select name="priority" [(ngModel)]="prefs.priority"><option>Actividades</option><option>Comercial</option><option>Inventario</option></select></label>
          <label>Escalar seguimientos pendientes después de (horas)<input name="hours" type="number" min="2" max="168" [(ngModel)]="prefs.escalationHours" required></label>
          <div class="form-actions"><button class="primary" [disabled]="busy">Guardar preferencias</button></div>
        </form>
      }
    </details>
  `
})
export class NoticePreferences {
  api = inject(Api);
  draft?:Preferences;
  metrics:{group:string;read:number;meanHours:number|null}[] = [];
  hours = new Intl.NumberFormat('es-MX',{maximumFractionDigits:1});
  busy = false;
  message = '';
  notice = '';
  changed = output<void>();
  async load() {
    try {
      [this.draft,this.metrics] = await Promise.all([this.api.get<Preferences>('notificaciones/preferencias'),
        this.api.get<typeof this.metrics>('notificaciones/metricas')]);
    }
    catch (error) { this.message = errorText(error); }
  }
  async save(prefs:Preferences) {
    if (this.busy) return;
    this.busy = true;
    this.message = this.notice = '';
    try {
      await this.api.send('PUT','notificaciones/preferencias',prefs);
      this.notice = 'Preferencias guardadas.';
      this.changed.emit();
    } catch (error) { this.message = errorText(error); }
    finally { this.busy = false; }
  }
}
