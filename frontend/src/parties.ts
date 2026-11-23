import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DuplicateTools } from './growth-tools';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api, currency, dateText, errorText, folio, PartyOption } from './api';

interface Party extends PartyOption {
  personType: string; contact: string; email: string; phone: string; source: string;
  rfc: string; industry: string; address: string; stage: string; active: boolean; ownerId?: number;
}
interface Contact { id: number; name: string; position: string; email: string; phone: string; }
interface Opportunity { id: number; description: string; interest: string; value: number; expectedClose: string | null; stage: string; }
interface Details { party: Party; contacts: Contact[]; opportunities: Opportunity[]; owner: string; createdAt: string | null; notes: { id: number; description: string; actor: string; at: string }[]; }
interface DirectoryRow { party: Party; owner: string; opportunityCount: number; opportunityValue: number; lastActivity: string | null; }
type DirectoryParty = Party & Omit<DirectoryRow, 'party'>;
type Category = '' | 'Cliente' | 'Prospecto' | 'inactive';
type DetailSection = 'summary' | 'opportunities' | 'quotes' | 'activity';
interface RelatedQuote { id: number; date: string; status: string; total: number; }
interface Activity { key: string; type: string; description: string; actor: string; at: string; }
const activityDate = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeZone: 'America/Mexico_City' });

@Component({
  imports: [FormsModule, RouterLink, DuplicateTools],
  templateUrl: './parties.html',
  styleUrl: './parties.css',
})
export class PartiesPage {
  api = inject(Api);
  route = inject(ActivatedRoute);
  private router = inject(Router);
  money = currency;
  date = dateText;
  rows: DirectoryParty[] = [];
  code = folio;
  localDate = (value: string) => activityDate.format(new Date(value));
  section: DetailSection = 'summary';
  sectionBusy = false;
  sectionError = false;
  confirmStatus = false;
  quotes: RelatedQuote[] = [];
  activity: Activity[] = [];
  private detailRequest = 0;
  private sectionRequest = 0;
  owners: {id: number; name: string}[] = [];
  details: Details | null = null;
  edit: Party | null = null;
  contactEdit: Omit<Contact, 'id'> | null = null;
  opportunityEdit: Opportunity | null = null;
  message = '';
  notice = '';
  busy = false;
  loading = true;
  search = '';
  type: Category = '';
  status = '';
  industry = '';
  adviser = '';
  page = 1;
  perPage = 8;
  industries: string[] = [];
  advisers: string[] = [];
  duplicates = new Set<number>();
  duplicatesOnly = false;
  totals: Record<Category, number> = { '': 0, Cliente: 0, Prospecto: 0, inactive: 0 };
  readonly types: {value: Category; title: string; label: string; description: string; icon: string}[] = [
    {value: '', title: 'Total de cartera', label: 'Todas', description: 'Fichas registradas', icon: '▤'},
    {value: 'Cliente', title: 'Clientes activos', label: 'Clientes activos', description: 'Cuentas activas', icon: '✓'},
    {value: 'Prospecto', title: 'Prospectos activos', label: 'Prospectos', description: 'Seguimiento comercial', icon: '◇'},
    {value: 'inactive', title: 'Fichas inactivas', label: 'Inactivas', description: 'Cuentas o prospectos desactivados', icon: '◷'},
  ];
  leadStages = ['Nuevo', 'En seguimiento', 'Calificado', 'No calificado'];
  stages = ['Nueva', 'En seguimiento', 'Propuesta', 'Negociación', 'Ganada', 'Perdida'];

  ngOnInit() {
    void this.load();
    const ficha = Number(this.route.snapshot.queryParamMap.get('ficha') || 0);
    if (ficha) void this.openDetails(ficha);
    if (this.api.manager) {
      void this.api.get<typeof this.owners>('clientes/responsables')
        .then(result => this.owners = result).catch(error => this.message = errorText(error));
    }
  }
  async load() {
    try {
      const records = await this.api.get<DirectoryRow[]>('clientes/directorio');
      this.rows = records.map(({ party, ...summary }) => ({ ...party, ...summary }));
      this.totals = {
        '': this.rows.length,
        Cliente: this.rows.filter(row => row.active && row.kind === 'Cliente').length,
        Prospecto: this.rows.filter(row => row.active && row.kind === 'Prospecto').length,
        inactive: this.rows.filter(row => !row.active).length,
      };
      this.industries = this.options(this.rows.map(row => row.industry));
      this.advisers = this.options(this.rows.map(row => row.owner));
      this.duplicates = this.findDuplicates();
      this.page = Math.min(this.page, this.pageCount(this.filtered().length));
    }
    catch (error) { this.message = errorText(error); }
    finally { this.loading = false; }
  }
  filtered() {
    const q = this.search.trim().toLocaleLowerCase('es-MX');
    return this.rows.filter(x =>
      (this.type === 'inactive' ? !x.active : !this.type || x.active && x.kind === this.type) &&
      (!this.industry || x.industry === this.industry) &&
      (!this.adviser || x.owner === this.adviser) &&
      (!this.status || x.active === (this.status === 'active')) &&
      (!this.duplicatesOnly || this.duplicates.has(x.id)) &&
      [x.name, x.contact, x.email, x.rfc, x.phone].some(value => value.toLocaleLowerCase('es-MX').includes(q)));
  }
  setType(value: Category) { this.type = value; this.status = ''; this.page = 1; }
  pageCount(length: number) { return Math.max(1, Math.ceil(length / this.perPage)); }
  endOfPage(length: number) { return Math.min(length, this.page * this.perPage); }
  initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase(); }
  partyStatus(party: Party) { return !party.active ? 'Inactivo' : party.kind === 'Cliente' ? 'Activo' : party.stage; }
  openOpportunities(rows: Opportunity[]) { return rows.filter(op => op.stage !== 'Ganada' && op.stage !== 'Perdida'); }
  private options(values: string[]) {
    return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es-MX'));
  }
  private findDuplicates() {
    const result = new Set<number>();
    const fields = new Map<string, number>();
    for (const row of this.rows.filter(item => item.active)) {
      const phone = row.phone.replace(/\D/g, '');
      const values = [
        ['email', row.email.trim().toLowerCase()], ['phone', phone.length >= 7 ? phone : ''],
        ['rfc', row.rfc.trim().toLowerCase()],
      ];
      for (const [field, value] of values) {
        if (!value) continue;
        const key = field + ':' + value;
        const other = fields.get(key);
        if (other !== undefined) { result.add(other); result.add(row.id); }
        else fields.set(key, row.id);
      }
    }
    return result;
  }
  toggleDuplicates() {
    this.duplicatesOnly = !this.duplicatesOnly;
    this.search = this.status = this.type = this.industry = this.adviser = '';
    this.page = 1;
  }
  exportDirectory() {
    const rows = [['Empresa', 'Tipo', 'RFC', 'Contacto', 'Correo', 'Teléfono', 'Industria', 'Origen', 'Asesor', 'Oportunidades abiertas', 'Valor MXN', 'Estado', 'Última actividad'],
      ...this.filtered().map(row => [row.name, row.kind, row.rfc, row.contact, row.email, row.phone, row.industry,
        row.source, row.owner, row.opportunityCount, row.opportunityValue, this.partyStatus(row), row.lastActivity || ''])];
    const csv = rows.map(row => row.map(cell => {
      const text = String(cell);
      const value = typeof cell === 'string' && /^\s*[=+@-]/.test(text) ? "'" + text : text;
      return '"' + value.replaceAll('"', '""') + '"';
    }).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'BUMI-directorio-clientes.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  newParty() {
    this.resetFeedback();
    this.edit = {id: 0, name: '', kind: this.type === 'Cliente' ? 'Cliente' : 'Prospecto', personType: 'Empresa', contact: '', email: '',
      phone: '', source: '', rfc: '', industry: '', address: '', stage: 'Nuevo', active: true};
  }
  beginEdit(p: Party) {
    this.resetFeedback();
    this.edit = {...p};
    window.scrollTo({top: 0, behavior: 'smooth'});
  }
  closeDetails() {
    this.detailRequest++;
    this.sectionRequest++;
    this.details = this.contactEdit = this.opportunityEdit = this.edit = null;
    this.section = 'summary';
    this.confirmStatus = false;
  }
  returnToDirectory() {
    this.closeDetails();
    this.resetFeedback();
    if (this.route.snapshot.queryParamMap.has('ficha')) void this.router.navigateByUrl('/clientes', { replaceUrl: true });
  }
  detailSections() {
    const sections: {key: DetailSection; label: string}[] = [
      { key: 'summary', label: 'Resumen' }, { key: 'opportunities', label: 'Oportunidades' },
    ];
    if (this.api.enabled('cotizaciones')) sections.push({ key: 'quotes', label: 'Cotizaciones' });
    if (this.api.enabled('historial')) sections.push({ key: 'activity', label: 'Actividad' });
    return sections;
  }
  async selectSection(section: DetailSection) {
    const id = this.details?.party.id;
    if (!id || section === this.section) return;
    this.section = section;
    this.sectionBusy = section === 'quotes' || section === 'activity';
    this.sectionError = false;
    const request = ++this.sectionRequest;
    try {
      if (section === 'quotes') {
        this.quotes = [];
        const result = await this.api.get<RelatedQuote[]>('cotizaciones?ficha=' + id);
        if (request === this.sectionRequest) this.quotes = result;
      } else if (section === 'activity') {
        this.activity = [];
        const result = await this.api.get<Activity[]>('historial?ficha=' + id);
        if (request === this.sectionRequest) this.activity = result;
      }
    } catch {
      if (request === this.sectionRequest) this.sectionError = true;
    } finally {
      if (request === this.sectionRequest) this.sectionBusy = false;
    }
  }
  newContact() { this.contactEdit = {name: '', position: '', email: '', phone: ''}; }
  newOpportunity() { this.opportunityEdit = {id: 0, description: '', interest: '', value: 0, expectedClose: null, stage: 'Nueva'}; }
  resetFeedback() { this.message = this.notice = ''; }

  async openDetails(id: number) {
    this.resetFeedback();
    this.closeDetails();
    const request = this.detailRequest;
    try {
      const result = await this.api.get<Details>('clientes/' + id + '/detalle');
      if (request !== this.detailRequest) return;
      this.details = result;
      window.scrollTo({top: 0, behavior: 'smooth'});
    } catch (error) { if (request === this.detailRequest) this.message = errorText(error); }
  }

  async reloadMerged(id:number) {
    await this.load();
    if (this.details?.party.id === id) {
      try { this.details = await this.api.get<Details>('clientes/' + id + '/detalle'); }
      catch (error) { this.message = errorText(error); }
    }
  }
  async saveParty() {
    if (!this.edit) return;
    const record = this.edit;
    await this.mutate(record.id ? 'PUT' : 'POST', 'clientes' + (record.id ? '/' + record.id : ''), record,
      'Registro guardado.', this.details?.party.id === record.id ? record.id : undefined);
    if (!this.message) this.edit = null;
  }
  async toggleParty(party: Party) {
    await this.mutate('PUT', 'clientes/' + party.id, {...party, active: !party.active},
      party.active ? 'Ficha desactivada.' : 'Ficha reactivada.', party.id);
    if (!this.message) this.confirmStatus = false;
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
      if (detailId && this.details?.party.id === detailId) {
        const result = await this.api.get<Details>('clientes/' + detailId + '/detalle');
        if (this.details?.party.id === detailId) this.details = result;
      }
      await this.load();
      this.notice = success;
    } catch (error) { this.message = errorText(error); }
    finally { this.busy = false; }
  }
}
