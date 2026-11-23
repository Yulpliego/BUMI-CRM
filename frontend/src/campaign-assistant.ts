import { Component, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText, PartyOption } from './api';
import { BumiIcon } from './icon';

interface Idea { channel: string; action: string; measure: string; historyCount: number; historicalRate: number | null; }
interface Suggestions {
  id: number; name: string; kind: string; segment: string; campaignName: string; goal: string; need: string; options: Idea[];
}
export interface CampaignDraft {
  name: string; goal: string; description: string; channel: string; segment: string; audienceIds: number[];
}

@Component({
  selector: 'bumi-campaign-assistant',
  imports: [FormsModule, BumiIcon],
  styleUrl: './campaign-assistant.css',
  template: `
    <section class="panel campaign-assistant">
      <header>
        <div class="assistant-symbol"><bumi-icon name="asistente" /></div>
        <div><h2>Asistente de campañas</h2><p>Parte de una necesidad real y recibe ideas para llegar a personas interesadas.</p></div>
        <button type="button" class="secondary" [attr.aria-expanded]="open" aria-controls="campaign-idea-form" (click)="open = !open">{{open ? 'Ocultar' : 'Crear con IA'}}</button>
      </header>
      <div id="campaign-idea-form" [hidden]="!open">
        <form class="form-grid" (ngSubmit)="suggest()">
          <label>Cliente o prospecto<select name="party" [(ngModel)]="partyId" (ngModelChange)="clear()" required>
            <option [ngValue]="0">Selecciona una ficha</option>
            @for (person of audience(); track person.id) { <option [ngValue]="person.id">{{person.name}} · {{person.kind}}</option> }
          </select></label>
          <label>Objetivo<select name="objective" [(ngModel)]="objective" (ngModelChange)="clear()">
            <option>Captar prospectos</option><option>Generar cotizaciones</option><option>Reactivar clientes</option>
          </select></label>
          <label class="wide">¿Qué necesita o qué quieres ofrecer?<textarea name="need" [(ngModel)]="need" (ngModelChange)="clear()" rows="2" minlength="8" maxlength="250"
            placeholder="Ej. Presentar una demostración del catálogo a empresas que están renovando su equipo" required></textarea></label>
          <div class="form-actions wide"><button class="primary" [disabled]="busy || !partyId || need.trim().length < 8">{{busy ? 'Preparando ideas…' : 'Sugerir campañas'}}</button></div>
        </form>
        @if (message) { <p class="error" role="alert">{{message}}</p> }
        @if (result; as ideas) {
          <div class="assistant-results" aria-live="polite">
            <h3>Ideas para {{ideas.name}}</h3>
            <div class="assistant-ideas">
              @for (idea of ideas.options; track idea.channel; let first = $first) {
                <article>
                  <div><strong>{{idea.channel}}</strong>@if (first) { <span>Primera sugerencia</span> }</div>
                  <p>{{idea.action}}</p><p>{{idea.measure}}</p>
                  <small>
                    @if (idea.historicalRate !== null) { {{percent.format(idea.historicalRate)}} de prospectos por contacto · {{idea.historyCount}} campañas finalizadas }
                    @else { Sin historial en este canal. }
                  </small>
                  <button type="button" class="secondary" (click)="use(ideas, idea)">Usar borrador</button>
                </article>
              }
            </div>
          </div>
        }
        <p class="assistant-note">BUMI compara tu objetivo y necesidad con los resultados históricos. Puedes revisar cada borrador antes de guardarlo.</p>
      </div>
    </section>
  `
})
export class CampaignAssistant {
  private readonly api = inject(Api);
  readonly audience = input.required<PartyOption[]>();
  readonly draft = output<CampaignDraft>();
  readonly percent = new Intl.NumberFormat('es-MX', { style: 'percent', maximumFractionDigits: 1 });
  partyId = 0;
  objective = 'Captar prospectos';
  need = '';
  open = false;
  busy = false;
  message = '';
  result: Suggestions | null = null;
  private request = 0;

  clear() { this.result = null; this.message = ''; this.request++; this.busy = false; }
  async suggest() {
    if (this.busy || !this.partyId || this.need.trim().length < 8) return;
    this.clear();
    const request = this.request;
    this.busy = true;
    try {
      const result = await this.api.send<Suggestions>('POST', 'marketing/asistente', {
        partyId: this.partyId, objective: this.objective, need: this.need,
      });
      if (request === this.request) this.result = result;
    } catch (error) { if (request === this.request) this.message = errorText(error); }
    finally { if (request === this.request) this.busy = false; }
  }
  use(ideas: Suggestions, idea: Idea) {
    this.draft.emit({
      name: ideas.campaignName, goal: ideas.goal, segment: ideas.segment, channel: idea.channel, audienceIds: [ideas.id],
      description: (ideas.need + '\n\n' + idea.action + '\n' + idea.measure).slice(0, 500),
    });
  }
}

