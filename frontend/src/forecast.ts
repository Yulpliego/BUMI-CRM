import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from './api';

interface ChannelPoint {
  channel: string; campaigns: number; reached: number; leads: number;
  estimate: { expected: number; low: number; high: number; rate: number };
}
interface Forecast {
  available: boolean; target: number; history: {channel: string; campaigns: number; reached: number; leads: number}[];
  contacts?: number; leads?: number; campaigns?: number; rate?: number; expected?: number;
  low?: number; high?: number; limited?: boolean; message?: string;
  projections: ChannelPoint[];
}

@Component({
  selector: 'bumi-forecast',
  imports: [FormsModule],
  styleUrl: './forecast.css',
  template: `
    <section class="panel padded marketing-forecast">
      <header class="section-head"><div><h2>Pronóstico de prospectos por canal</h2>
      <p>Un prospecto, también llamado lead, es una persona o empresa que mostró interés. El pronóstico estima cuántos podrían interesarse entre los contactos previstos.</p></div>
      <button type="button" class="secondary marketing-range-control" [attr.aria-pressed]="showRange" (click)="showRange = !showRange">
        <span aria-hidden="true">↕</span> {{showRange ? 'Ocultar rango' : 'Mostrar rango'}} al 95 %
      </button></header>
      <form class="forecast-form" (ngSubmit)="load()">
        <label>Canal<select name="channel" [(ngModel)]="channel"><option value="">Todos los canales</option>
          @for (value of channels; track value) {<option>{{value}}</option>}</select></label>
        <label>Contactos previstos<input type="number" name="target" [(ngModel)]="target" min="1" max="100000" step="1" required></label>
        <button class="primary" [disabled]="busy || !target">Calcular pronóstico</button>
      </form>
      @if (message) {<p class="error" role="alert">{{message}}</p>}
      @if (data; as result) {
        @if (result.available) {
          @let ceiling = maximum(result);
          @let current = selected(result);
          <div class="marketing-report">
            <div class="marketing-report-heading"><span>Canal</span><span>Prospectos estimados</span><span>Total</span></div>
            <div class="marketing-report-rows">
              @for (point of ranked(result); track point.channel) {
                <button class="marketing-report-row" type="button" [attr.aria-pressed]="current?.channel === point.channel"
                  [attr.aria-label]="point.channel + ': ' + point.estimate.expected + ' prospectos estimados, rango de ' + point.estimate.low + ' a ' + point.estimate.high"
                  (click)="selectedChannel = point.channel" (focus)="selectedChannel = point.channel">
                  <span class="marketing-report-name">{{point.channel}}</span>
                  <span class="marketing-report-track" aria-hidden="true">
                    <span class="marketing-report-bar" [style.width.%]="point.estimate.expected / ceiling * 100"></span>
                    @if (showRange) {
                      <span class="marketing-report-range" [style.left.%]="point.estimate.low / ceiling * 100"
                        [style.width.%]="(point.estimate.high - point.estimate.low) / ceiling * 100"></span>
                    }
                  </span>
                  <strong>{{number.format(point.estimate.expected)}}</strong>
                </button>
              }
            </div>
            <div class="marketing-report-axis" aria-hidden="true"><span></span><div>
              @for (n of [0, .25, .5, .75, 1]; track n) { <span>{{number.format(ceiling * n)}}</span> }
            </div><span></span></div>
            <div class="marketing-report-legend"><span><i aria-hidden="true"></i> Estimación</span>
              @if (showRange) { <span><b aria-hidden="true"></b> Rango orientativo al 95 %</span> }
            </div>
          </div>

          @if (current) {
            <div class="forecast-channel-detail" aria-live="polite">
              <div><strong>{{current.channel}}</strong><p>De {{result.target}} contactos, se estima que {{current.estimate.expected}} mostrarían interés.</p></div>
              <div><strong>{{current.estimate.low}}–{{current.estimate.high}}</strong><small>Rango orientativo de prospectos</small></div>
              <div><strong>{{current.leads}} de {{current.reached}}</strong><small>Mostraron interés en {{current.campaigns}} campañas finalizadas</small></div>
            </div>
          }
          <div class="forecast-results">
            <div><small>Estimación con tasa combinada</small><strong>{{result.expected}}</strong><span>Rango orientativo: {{result.low}}–{{result.high}}</span></div>
            <div><small>Conversión histórica</small><strong>{{percent.format(result.rate || 0)}}</strong>
              <span>{{result.leads}} prospectos de {{result.contacts}} contactos</span></div>
            <div><small>Base del cálculo</small><strong>{{result.campaigns}}</strong><span>Campañas finalizadas</span></div>
          </div>
          @if (result.limited) {<p class="notice">Muestra limitada. Usa el resultado como punto de partida para una prueba pequeña.</p>}
          <details class="campaign-audience"><summary>Cómo se calcula</summary>
            <p class="muted">BUMI proyecta la conversión observada a {{result.target}} contactos. El rango refleja la incertidumbre de esa tasa histórica al 95 % y depende de que las condiciones de campaña sean comparables.</p>
            @for (example of result.history; track example.channel) {
              <div class="report-row"><strong>{{example.channel}}</strong><span>{{example.leads}} de {{example.reached}} contactos</span></div>
            }
          </details>
        } @else {
          <p class="empty">{{result.message}}</p>
        }
      }
    </section>
  `
})
export class ForecastPanel {
  api = inject(Api);
  channels = ['Email', 'Eventos', 'Redes sociales', 'Teléfono', 'Otro'];
  target = 100;
  channel = '';
  selectedChannel = '';
  showRange = true;
  data: Forecast | null = null;
  busy = false;
  message = '';
  number = new Intl.NumberFormat('es-MX');
  percent = new Intl.NumberFormat('es-MX',{style:'percent',maximumFractionDigits:1});
  selected(result: Forecast) {
    return result.projections.find(point => point.channel === this.selectedChannel) ?? this.ranked(result)[0] ?? null;
  }
  ranked(result: Forecast) {
    return [...result.projections].sort((a, b) => b.estimate.expected - a.estimate.expected || a.channel.localeCompare(b.channel, 'es-MX'));
  }
  maximum(result: Forecast) {
    const high = Math.max(4, ...result.projections.map(item => item.estimate.high));
    const step = 10 ** Math.floor(Math.log10(high / 4));
    return Math.ceil(high / (4 * step)) * 4 * step;
  }
  async ngOnInit() { await this.load(); }
  async load() {
    if (this.busy) return;
    this.busy = true;
    this.message = '';
    try {
      const params = new URLSearchParams({canal:this.channel,contactos:String(this.target)});
      this.data = await this.api.get<Forecast>('marketing/pronostico?' + params);
      this.selectedChannel = this.channel;
    } catch (error) { this.message = errorText(error); }
    finally { this.busy = false; }
  }
}
