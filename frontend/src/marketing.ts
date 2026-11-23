import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ForecastPanel } from './forecast';
import { BumiIcon } from './icon';
import { CampaignAssistant, CampaignDraft } from './campaign-assistant';
import { AttributionTools } from './growth-tools';
import { Api, currency, dateInput, dateText, errorText, PartyOption } from './api';

interface Campaign {
  id: number; name: string; goal: string; description: string; channel: string; segment: string;
  status: string; start: string; end: string; reached: number; leads: number; owner: string; audienceIds: number[]; audience?: PartyOption[];
}

interface Performance {
  prospects: number; soldProspects: number; cost: number; quotes: number; sales: number; revenue: number;
}
interface Attribution {
  report: { campaign: { id: number; channel: string }; segments: (Performance & { segment: string })[] }[];
}
const emptyPerformance = (): Performance => ({ prospects: 0, soldProspects: 0, cost: 0, quotes: 0, sales: 0, revenue: 0 });
const sumPerformance = (left: Performance, right: Performance): Performance => ({
  prospects: left.prospects + right.prospects, soldProspects: left.soldProspects + right.soldProspects,
  cost: left.cost + right.cost, quotes: left.quotes + right.quotes, sales: left.sales + right.sales,
  revenue: left.revenue + right.revenue,
});

@Component({
  imports: [FormsModule, ForecastPanel, AttributionTools, CampaignAssistant, BumiIcon],
  templateUrl: './marketing.html',
  styleUrl: './marketing.css',
})
export class MarketingPage {
  api = inject(Api);
  selectedId = Number(inject(ActivatedRoute).snapshot.queryParamMap.get('id') || 0);
  date = dateText;
  money = currency;
  number = new Intl.NumberFormat('es-MX');
  percent = new Intl.NumberFormat('es-MX', { style: 'percent', maximumFractionDigits: 1 });
  attribution: Attribution | null = null;
  attributionError = '';
  groupBy: 'channel' | 'segment' = 'channel';
  campaigns: Campaign[] = [];
  audience: PartyOption[] = [];
  edit: Campaign | null = null;
  busy = false;
  loading = true;
  search = '';
  channelFilter = '';
  statusFilter = '';

  filtered() {
    const query = this.search.trim().toLocaleLowerCase('es-MX');
    return this.campaigns.filter(item => (!this.statusFilter || item.status === this.statusFilter) &&
      (!this.channelFilter || item.channel === this.channelFilter) &&
      [item.name, item.goal, item.segment, item.channel].some(value => value.toLocaleLowerCase('es-MX').includes(query)));
  }
  message = '';
  notice = '';
  channels = ['Email', 'Eventos', 'Redes sociales', 'Teléfono', 'Otro'];
  statuses = ['Planeada', 'Activa', 'Finalizada', 'Pausada'];
  get canCreate() { return this.api.manager || this.canEdit; }
  get canEdit() { return ['Administrador', 'Marketing'].includes(this.api.profile()?.role || ''); }

  ngOnInit() { void this.load(); void this.loadAttribution(); }
  async loadAttribution() {
    this.attributionError = '';
    try { this.attribution = await this.api.get<Attribution>('marketing/atribucion'); }
    catch (error) { this.attributionError = errorText(error); }
  }
  selectedCampaign(rows: Campaign[]) { return rows.find(item => item.id === this.selectedId) ?? rows[0] ?? null; }
  campaignStats(id: number) {
    return (this.attribution?.report.find(row => row.campaign.id === id)?.segments ?? [])
      .reduce(sumPerformance, emptyPerformance());
  }
  totals() {
    return {
      active: this.campaigns.filter(item => item.status === 'Activa').length,
      reach: this.campaigns.reduce((sum, item) => sum + item.reached, 0),
      leads: this.campaigns.reduce((sum, item) => sum + item.leads, 0),
      revenue: (this.attribution?.report ?? []).reduce((total, row) =>
        total + row.segments.reduce((sum, item) => sum + item.revenue, 0), 0),
    };
  }
  profitRows() {
    const groups = new Map<string, Performance>();
    for (const row of this.attribution?.report ?? []) {
      if (this.groupBy === 'channel' && !groups.has(row.campaign.channel)) groups.set(row.campaign.channel, emptyPerformance());
      for (const item of row.segments) {
        const label = this.groupBy === 'channel' ? row.campaign.channel : item.segment;
        groups.set(label, sumPerformance(groups.get(label) ?? emptyPerformance(), item));
      }
    }
    return [...groups].map(([label, values]) => ({ label, ...values }))
      .sort((a, b) => b.revenue - a.revenue || a.label.localeCompare(b.label, 'es-MX'));
  }
  exportCampaigns() {
    const rows = [['Campaña', 'Objetivo', 'Canal', 'Segmento', 'Inicio', 'Fin', 'Responsable', 'Estado', 'Alcance', 'Leads', 'Ingresos atribuidos MXN'],
      ...this.filtered().map(row => [row.name, row.goal, row.channel, row.segment, row.start, row.end, row.owner,
        row.status, row.reached, row.leads, this.attribution ? this.campaignStats(row.id).revenue : ''])];
    const csv = rows.map(row => row.map(cell => {
      const text = typeof cell === 'string' && /^\s*[=+@-]/.test(cell) ? "'" + cell : String(cell);
      return '"' + text.replaceAll('"', '""') + '"';
    }).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'BUMI-campanas.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async load() {
    try {
      const [campaigns, audience] = await Promise.all([
        this.api.get<Campaign[]>('marketing'),
        this.canCreate ? this.api.get<PartyOption[]>('marketing/publico') : Promise.resolve([])
      ]);
      this.campaigns = campaigns;
      this.audience = audience;
    } catch (error) { this.message = errorText(error); }
    finally { this.loading = false; }
  }
  newCampaign(draft?: CampaignDraft) {
    this.beginEdit({id: 0, name: '', goal: '', description: '', channel: 'Email', segment: '', status: 'Planeada',
      start: dateInput(), end: dateInput(14), reached: 0, leads: 0, owner: '', audienceIds: [], ...draft});
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
      if (id) this.selectedId = id;
      await Promise.all([this.load(), this.loadAttribution()]);
    } catch (error) { this.message = errorText(error); }
    finally { this.busy = false; }
  }
}
