import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api, currency, dateText, errorText, folio, PartyOption } from './api';
import { OpportunityActions } from './growth-tools';
import { NoticePreferences, SchedulePanel } from './work-tools';

type Person = {id: number; name: string};
type OpportunityOption = {id: number; description: string};
type Task = {id: number; title: string; description: string; type: string; status: string; due: string;
  ownerId?: number; owner?: string; partyId?: number | null; party?: string; opportunityId?: number | null; quoteId?: number | null; rescheduleReason?: string};
type Opportunity = { id: number; partyId: number; party: string; owner: string; description: string; interest: string;
  value: number; expectedClose: string | null; stage: string; updatedAt: string; };
type HistoryItem = {key: string; partyId: number; party: string; type: string; description: string; actor: string; at: string};
export type Notice = {key: string; title: string; detail: string; at: string | null; route: string; recordId: number; read: boolean; group: string; muted: boolean};
const stages = ['Nueva', 'En seguimiento', 'Propuesta', 'Negociación', 'Ganada', 'Perdida'];
const timestamp = (value: string) => new Intl.DateTimeFormat('es-MX', {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(value));
const dayKey = (value: Date) => new Intl.DateTimeFormat('sv-SE', {dateStyle: 'short'}).format(value);
const localInput = (value: Date) => dayKey(value) + 'T' + String(value.getHours()).padStart(2, '0') + ':' + String(value.getMinutes()).padStart(2, '0');

@Component({
  imports: [FormsModule, RouterLink, OpportunityActions],
  template: `
    <header class="page-head"><div><p class="eyebrow">GESTIÓN COMERCIAL</p><h1>Oportunidades</h1><p>Organiza el seguimiento y actualiza la etapa de cada negociación.</p></div>
      <a class="secondary button" routerLink="/clientes">← Volver a Clientes y prospectos</a></header>
    <div class="panel filters">
      <label>Buscar<input type="search" [(ngModel)]="search" placeholder="Ficha, oportunidad o producto"></label>
      <label>Responsable<select [(ngModel)]="owner"><option value="">Todos</option>@for (person of owners(); track person) {<option>{{person}}</option>}</select></label>
      <label class="check board-toggle"><input type="checkbox" [(ngModel)]="closed"> Mostrar ganadas y perdidas</label>
    </div>
    @if (message) {<p class="error" role="alert">{{message}}</p>}
    <bumi-opportunity-actions />
    @if (loading) {<p class="empty">Cargando oportunidades…</p>}
    <div class="kanban" aria-label="Tablero por etapa">
      @for (column of columns(); track column.stage) {
        <section class="kanban-column">
          <header><div><h2>{{column.stage}}</h2><small>{{money.format(column.total)}} MXN</small></div><span class="count-pill">{{column.items.length}}</span></header>
          @for (row of column.items; track row.id) {
            <article class="panel opportunity" [class.focus-card]="row.id === selected">
              <small>{{row.party}}</small><h3>{{row.description}}</h3><strong>{{money.format(row.value)}}</strong>
              @if (row.interest) {<p>{{row.interest}}</p>}
              <p>{{row.owner}} @if (row.expectedClose) { · Cierre {{shortDate(row.expectedClose)}} }</p>
              <label>Cambiar etapa<select [ngModel]="row.stage" [disabled]="busy" (ngModelChange)="move(row, $event)">
                @for (stage of stages; track stage) {<option>{{stage}}</option>}
              </select></label>
              <div class="actions"><a class="text-button" routerLink="/clientes" [queryParams]="{ficha:row.partyId}">Ver ficha</a>
              @if (api.enabled('agenda')) {<a class="text-button" routerLink="/agenda" [queryParams]="{nueva:1,ficha:row.partyId,oportunidad:row.id}">Agendar</a>}</div>
            </article>
          } @empty {<p class="empty">Sin oportunidades en esta etapa.</p>}
        </section>
      }
    </div>
  `
})
export class PipelinePage {
  api = inject(Api);
  route = inject(ActivatedRoute);
  rows: Opportunity[] = [];
  stages = stages;
  money = currency;
  shortDate = dateText;
  search = '';
  owner = '';
  loading = true;
  closed = false;
  message = '';
  busy = false;
  selected = Number(this.route.snapshot.queryParamMap.get('id') || 0);
  async ngOnInit() {
    try {
      this.rows = await this.api.get<Opportunity[]>('clientes/oportunidades/tablero');
      const selected = this.rows.find(row => row.id === this.selected);
      if (selected && stages.slice(-2).includes(selected.stage)) this.closed = true;
    }
    catch (error) { this.message = errorText(error); }
    finally { this.loading = false; }
  }
  owners() { return [...new Set(this.rows.map(x => x.owner))].sort(); }
  columns() {
    const query = this.search.trim().toLocaleLowerCase('es-MX');
    const visible = this.rows.filter(row => (!this.owner || row.owner === this.owner) &&
      [row.description, row.party, row.interest].some(text => text.toLocaleLowerCase('es-MX').includes(query)));
    return (this.closed ? stages : stages.slice(0, 4)).map(stage => {
      const items = visible.filter(row => row.stage === stage);
      return {stage, items, total: items.reduce((sum, row) => sum + row.value, 0)};
    });
  }
  async move(row: Opportunity, stage: string) {
    this.busy = true;
    this.message = '';
    try {
      await this.api.send('PATCH', 'clientes/oportunidades/' + row.id + '/etapa', {stage});
      row.stage = stage;
      if (stages.slice(-2).includes(stage)) this.closed = true;
    } catch (error) { this.message = errorText(error); this.rows = [...this.rows]; }
    finally { this.busy = false; }
  }
}

@Component({
  imports: [FormsModule, RouterLink, SchedulePanel],
  templateUrl: './agenda.html',
  styleUrl: './workspaces.css',
})
export class AgendaPage {
  api = inject(Api);
  route = inject(ActivatedRoute);
  rows: Task[] = [];
  people: Person[] = [];
  parties: PartyOption[] = [];
  quotes: {id: number; partyId: number; status: string}[] = [];
  options: OpportunityOption[] = [];
  draft: Task | null = null;
  originalDue = '';
  filter = '';
  calendarDay = false;
  dayIndex = (new Date().getDay() + 6) % 7;
  cursor = new Date();
  readonly activityFilters = [{value: '', label: 'Todas'}, {value: 'Pendiente', label: 'Pendientes'},
    {value: 'Completada', label: 'Completadas'}, {value: 'Cancelada', label: 'Canceladas'}];
  message = '';
  busy = false;
  selected = Number(this.route.snapshot.queryParamMap.get('id') || 0);
  types = ['Llamada', 'Reunión', 'Seguimiento', 'Tarea'];
  statuses = ['Pendiente', 'Completada', 'Cancelada'];
  format = timestamp;
  folioText = folio;
  async ngOnInit() {
    try {
      [this.rows, this.people, this.parties, this.quotes] = await Promise.all([
        this.api.get<Task[]>('agenda'), this.api.get<Person[]>('agenda/responsables'),
        this.api.enabled('clientes') ? this.api.get<PartyOption[]>('clientes') : Promise.resolve([]),
        this.api.enabled('cotizaciones') ? this.api.get<typeof this.quotes>('cotizaciones') : Promise.resolve([])
      ]);
      const focused = this.rows.find(item => item.id === this.selected);
      if (focused) { this.cursor = new Date(focused.due); this.dayIndex = (this.cursor.getDay() + 6) % 7; await this.edit(focused); }
      else if (this.route.snapshot.queryParamMap.get('nueva')) {
        this.create();
        const party = Number(this.route.snapshot.queryParamMap.get('ficha') || 0);
        if (party && this.draft) {
          await this.chooseParty(party);
          if (this.draft) this.draft.opportunityId = Number(this.route.snapshot.queryParamMap.get('oportunidad') || 0) || null;
        }
      }
    } catch (error) { this.message = errorText(error); }
  }
  create() {
    this.options = [];
    const due = new Date();
    due.setHours(due.getHours() + 1);
    if (dayKey(this.weekStart(due)) !== dayKey(this.weekStart())) {
      due.setFullYear(this.cursor.getFullYear(), this.cursor.getMonth(), this.cursor.getDate());
    }
    this.draft = {id: 0, title: '', due: localInput(due), description: '', type: 'Seguimiento',
      status: 'Pendiente', partyId: null, opportunityId: null, quoteId: null};
    window.scrollTo({top: 0, behavior: 'smooth'});
  }
  async edit(task: Task) {
    this.originalDue = task.due;
    this.draft = {...task, due: localInput(new Date(task.due)), rescheduleReason:''};
    await this.loadOptions(task.partyId ?? null);
    window.scrollTo({top: 0, behavior: 'smooth'});
  }
  async chooseParty(party: number | null) {
    if (!this.draft) return;
    this.draft.partyId = party;
    this.draft.opportunityId = this.draft.quoteId = null;
    await this.loadOptions(party);
  }
  private async loadOptions(party: number | null) {
    this.options = [];
    if (!party || !this.api.enabled('clientes')) return;
    try {
      const result = await this.api.get<{opportunities: OpportunityOption[]}>('clientes/' + party + '/detalle');
      if (this.draft?.partyId === party) this.options = result.opportunities;
    } catch (error) { this.message = errorText(error); }
  }
  selectedQuotes() { return this.quotes.filter(q => q.partyId === this.draft?.partyId); }
  private weekRows() {
    const start = this.weekStart();
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    return this.rows.filter(row => {
      const due = new Date(row.due);
      return due >= start && due < end;
    });
  }
  filtered() { return this.weekRows().filter(row => !this.filter || row.status === this.filter); }
  workload() {
    const counts = new Map<string, number>();
    const scheduled = this.weekRows().filter(row => row.status !== 'Cancelada');
    for (const row of scheduled) {
      const name = row.owner || 'Sin responsable';
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return Array.from(counts, ([owner, count]) => ({owner, count, share: Math.round(count / scheduled.length * 100)}))
      .sort((a, b) => b.count - a.count || a.owner.localeCompare(b.owner, 'es-MX'));
  }
  changeWeek(delta: number) {
    const target = new Date(this.cursor);
    target.setDate(target.getDate() + delta * 7);
    this.cursor = target;
  }
  today() {
    this.cursor = new Date();
    this.dayIndex = (this.cursor.getDay() + 6) % 7;
  }
  todayKey() { return dayKey(new Date()); }
  visibleDays() { const days = this.week(); return this.calendarDay ? days.slice(this.dayIndex, this.dayIndex + 1) : days; }
  private weekStart(cursor = this.cursor) {
    const date = new Date(cursor);
    date.setHours(0,0,0,0);
    date.setDate(date.getDate() - (date.getDay() + 6) % 7);
    return date;
  }
  week() {
    const start = this.weekStart();
    const items = this.filtered();
    return Array.from({length: 7}, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const key = dayKey(date);
      const label = new Intl.DateTimeFormat('es-MX', {weekday: 'short', day: 'numeric'}).format(date);
      const slots = new Map<number, Task[]>();
      for (const item of items) {
        const due = new Date(item.due);
        if (dayKey(due) !== key) continue;
        const hour = due.getHours();
        const group = slots.get(hour) ?? [];
        group.push(item);
        slots.set(hour, group);
      }
      return {key, label, slots};
    });
  }
  calendarHours(days: ReturnType<AgendaPage['week']>) {
    const scheduled = days.flatMap(day => [...day.slots.keys()]);
    const first = Math.min(8, ...scheduled);
    const last = Math.max(17, ...scheduled);
    return Array.from({length: last - first + 1}, (_, index) => first + index);
  }
  range() {
    const start = this.weekStart();
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const dates = new Intl.DateTimeFormat('es-MX', {day: 'numeric', month: 'long', year: 'numeric'});
    return 'Semana del ' + dates.formatRange(start, end);
  }
  time(value: string) { return new Intl.DateTimeFormat('es-MX', {timeStyle: 'short'}).format(new Date(value)); }
  newAt(value: string) {
    this.create();
    this.useSlot(value);
  }
  useSlot(value:string) {
    if (this.draft) this.draft.due = localInput(new Date(value));
  }
  rescheduling() { return !!this.draft?.id && this.draft.due !== localInput(new Date(this.originalDue)); }
  async save() {
    if (!this.draft || !this.draft.due) return;
    const due = this.draft.id && !this.rescheduling() ? this.originalDue : new Date(this.draft.due).toISOString();
    await this.persist({...this.draft, due});
  }
  async complete(task: Task) { await this.persist({...task, status: 'Completada'}); }
  private async persist(task: Task) {
    if (this.busy) return;
    this.busy = true;
    this.message = '';
    try {
      await this.api.send(task.id ? 'PUT' : 'POST', 'agenda' + (task.id ? '/' + task.id : ''), task);
      this.rows = await this.api.get<Task[]>('agenda');
      if (this.draft) { this.cursor = new Date(task.due); this.dayIndex = (this.cursor.getDay() + 6) % 7; }
      this.draft = null;
      void this.api.refreshNotices();
    } catch (error) { this.message = errorText(error); }
    finally { this.busy = false; }
  }
}

@Component({
  imports: [FormsModule, RouterLink],
  templateUrl: './history.html',
  styleUrl: './workspaces.css',
})
export class HistoryPage {
  api = inject(Api);
  route = inject(ActivatedRoute);
  party = Number(this.route.snapshot.queryParamMap.get('ficha') || 0);
  newParty = this.party;
  rows: HistoryItem[] = [];
  parties: PartyOption[] = [];
  profile?: {party: PartyOption & {rfc: string; active: boolean}; owner: string};
  private request = 0;
  busy = false;
  type = 'Comentario';
  text = '';
  message = '';
  format = timestamp;
  filterType = '';
  filterActor = '';
  filterStart = '';
  filterEnd = '';
  eventTypes = ['Agenda','Comentario','Contacto','Cotización','Ficha','Fusión','Llamada','Oportunidad','Reunión','Venta'];
  async ngOnInit() {
    await Promise.all([this.load(), this.loadProfile()]);
    if (this.api.enabled('clientes')) {
      try { this.parties = await this.api.get<PartyOption[]>('clientes'); }
      catch (error) { this.message = errorText(error); }
    }
  }
  async selectParty(id: number) {
    if (this.party !== id) this.rows = [];
    this.party = this.newParty = id;
    await Promise.all([this.load(), this.loadProfile()]);
  }
  private async loadProfile() {
    this.profile = undefined;
    const id = this.party;
    if (!id || !this.api.enabled('clientes')) return;
    try {
      const profile = await this.api.get<NonNullable<typeof this.profile>>('clientes/' + id + '/detalle');
      if (this.party === id) this.profile = profile;
    } catch (error) { if (this.party === id) this.message = errorText(error); }
  }
  async load() {
    const request = ++this.request;
    this.message = '';
    const params = new URLSearchParams();
    if (this.party) params.set('ficha',String(this.party));
    if (this.filterType) params.set('tipo',this.filterType);
    if (this.filterActor) params.set('autor',this.filterActor);
    if (this.filterStart) params.set('desde',new Date(this.filterStart+'T00:00:00').toISOString());
    if (this.filterEnd) {
      const last = new Date(this.filterEnd+'T00:00:00');
      last.setDate(last.getDate()+1);
      params.set('hasta',last.toISOString());
    }
    try {
      const rows = await this.api.get<HistoryItem[]>('historial?' + params);
      if (request === this.request) this.rows = rows;
    } catch (error) { if (request === this.request) this.message = errorText(error); }
  }
  summarySources() { return this.party ? this.rows.filter(x=>x.partyId===this.party).slice(0,3) : []; }
  showEvent(event:Event,key:string) {
    event.preventDefault();
    const item = document.getElementById('evento-'+key);
    item?.focus({preventScroll:true});
    item?.scrollIntoView({block:'center'});
  }
  reviewSummary() {
    this.newParty = this.party;
    this.type = 'Comentario';
    this.text = this.summarySources().map(x=>x.type+' · '+this.format(x.at)+' ['+x.key+'] '+x.description.slice(0,140)).join('\n');
    document.querySelector<HTMLTextAreaElement>('#registrar-interaccion textarea')?.focus();
  }
  async save() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.api.send('POST', 'historial/comentarios', {partyId: this.newParty, type: this.type, text: this.text});
      this.text = '';
      await this.selectParty(this.newParty);
    } catch (error) { this.message = errorText(error); }
    finally { this.busy = false; }
  }
}

@Component({
  imports:[NoticePreferences],
  templateUrl: './notices.html',
  styleUrl: './workspaces.css',
})
export class NoticesPage {
  api = inject(Api);
  router = inject(Router);
  rows: Notice[] = [];
  message = '';
  busy = false;
  filter = 'Todas';
  readonly categories: Record<string, string> = {'/agenda': 'Actividades', '/cotizaciones': 'Cotizaciones',
    '/oportunidades': 'Oportunidades', '/inventario': 'Stock'};
  readonly filters = ['Todas', 'Sin leer', ...Object.values(this.categories), 'Gerencia'];
  format = timestamp;
  async ngOnInit() { await this.load(); }
  unread() { return this.rows.filter(item => !item.read).length; }
  category(item: Notice) { return item.group === 'Gerencia' ? 'Gerencia' : this.categories[item.route] || item.group; }
  priority(item: Notice) {
    if (item.group === 'Gerencia' || item.title === 'Actividad vencida' || (item.route === '/inventario' && / · 0 disponibles$/.test(item.detail))) return 'Crítica';
    if (item.route === '/cotizaciones' || item.title === 'Próxima actividad') return 'Alta';
    if (item.route !== '/agenda') return 'Media';
    return 'Normal';
  }
  noticeIcon(item: Notice) {
    if (this.priority(item) === 'Crítica') return '!';
    if (item.route === '/agenda') return '◷';
    if (item.route === '/oportunidades') return '◎';
    return '▤';
  }
  critical() { return this.rows.filter(item => !item.read && this.priority(item) === 'Crítica'); }
  filtered() {
    return this.rows.filter(item => this.filter === 'Todas' || (this.filter === 'Sin leer' ? !item.read : this.category(item) === this.filter));
  }
  counts() {
    return this.filters.slice(2).map(name => {
      const items = this.rows.filter(item => this.category(item) === name);
      return {name, total: items.length, unread: items.filter(item => !item.read).length};
    }).filter(item => item.name !== 'Gerencia' || item.total > 0);
  }
  private updateBadge() { this.api.unread.set(this.rows.filter(item=>!item.read && !item.muted).length); }
  async load() {
    if (this.busy) return;
    this.busy = true;
    this.message = '';
    try { this.rows = await this.api.get<Notice[]>('notificaciones'); this.updateBadge(); }
    catch (error) { this.message = errorText(error); }
    finally { this.busy = false; }
  }
  private async markRead(item: Notice) {
    await this.api.send('PUT', 'notificaciones/' + encodeURIComponent(item.key) + '/leida');
    item.read = true;
  }
  async mark(item: Notice) { if (!item.read) await this.markItems([item]); }
  async markAll() { await this.markItems(this.rows.filter(item => !item.read)); }
  private async markItems(items: Notice[]) {
    if (this.busy) return;
    this.busy = true;
    this.message = '';
    try {
      for (let i = 0; i < items.length; i += 6) {
        const results = await Promise.allSettled(items.slice(i, i + 6).map(item => this.markRead(item)));
        const failure = results.find(result => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
      }
    } catch (error) { this.message = errorText(error); }
    finally { this.updateBadge(); this.busy = false; }
  }
  async open(item: Notice) {
    await this.mark(item);
    await this.router.navigate([item.route], {queryParams: {id: item.recordId}});
  }
}
