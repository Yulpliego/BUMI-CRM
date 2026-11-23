import { Component, effect, inject, input, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import type { QuoteClient, QuoteDocument } from './quote-document';
import { Api } from './api';
import { quoteMail } from './quote-mail';

@Component({
  selector: 'bumi-quote-preview',
  styleUrl: './quote-preview.css',
  template: `
    <section class="panel quote-pdf" aria-labelledby="quote-pdf-heading">
      <header>
        <div><h2 id="quote-pdf-heading">Vista previa de la propuesta</h2><small>{{name()}}</small></div>
        @if (pdf(); as file) {
          <div class="actions">
            <a class="secondary button" [href]="file.url" target="_blank" rel="noopener">Imprimir PDF</a>
            <a class="secondary button" [href]="file.url" [download]="name()">Descargar PDF</a>
            <button class="secondary" type="button" (click)="copyLink()">Copiar enlace interno</button>
            <button class="secondary" type="button" (click)="share()">Compartir archivo</button>
            <button class="primary" type="button" [disabled]="preparingMail()" (click)="openMail()">Preparar correo con PDF</button>
          </div>
        }
      </header>
      @if (message()) {<p class="quote-pdf-status" role="status">{{message()}}</p>}
      @if (manualLink()) {
        <label class="quote-pdf-status">Enlace interno (requiere iniciar sesión)
          <input [value]="internalLink()" readonly (focus)="selectLink($event)">
        </label>
      }
      @if (error()) {<p class="error" role="alert">{{error()}} <button class="text-button" type="button" (click)="retry.update(n => n + 1)">Reintentar</button></p>}
      @else if (pdf(); as file) {
        <iframe [src]="file.src" title="Vista previa del documento PDF"></iframe>
      } @else {<p class="empty" role="status">Preparando el documento…</p>}
    </section>
  `
})
export class QuotePreview {
  readonly quote = input.required<QuoteDocument>();
  private readonly sanitizer = inject(DomSanitizer);
  private readonly api = inject(Api);
  readonly pdf = signal<{blob: Blob; url: string; src: SafeResourceUrl; email?: string} | null>(null);
  readonly error = signal('');
  readonly message = signal('');
  readonly manualLink = signal(false);
  readonly retry = signal(0);
  readonly preparingMail = signal(false);
  private logo?: Promise<Uint8Array | undefined>;

  constructor() {
    effect(onCleanup => {
      const quote = this.quote();
      this.retry();
      const client = quote.partyId && this.api.enabled('clientes')
        ? this.api.get<{party: QuoteClient}>('clientes/' + quote.partyId + '/detalle').then(result => result.party).catch(() => undefined)
        : Promise.resolve(undefined);
      this.pdf.set(null);
      this.message.set('');
      this.error.set('');
      this.manualLink.set(false);
      let active = true;
      let url: string | undefined;
      onCleanup(() => { active = false; if (url) URL.revokeObjectURL(url); });
      this.logo ??= fetch('/bumi-identidad.png').then(async response =>
        response.ok ? new Uint8Array(await response.arrayBuffer()) : undefined).catch(() => undefined);
      void Promise.all([import('./quote-document'), this.logo, client]).then(([library, logo, recipient]) => {
        if (!active) return;
        const blob = library.makeQuotePdf(quote, logo, recipient).output('blob');
        url = URL.createObjectURL(blob);
        this.pdf.set({blob, url, email: recipient?.email, src: this.sanitizer.bypassSecurityTrustResourceUrl(url + '#view=FitH')});
      }).catch(() => { if (active) this.error.set('No se pudo generar el PDF.'); });
    });
  }
  name() { return 'BUMI-COT-' + String(this.quote().id).padStart(4, '0') + '.pdf'; }
  internalLink() {
    const url = new URL('/cotizaciones', location.origin);
    url.searchParams.set('id', String(this.quote().id));
    return url.href;
  }
  selectLink(event: FocusEvent) { (event.target as HTMLInputElement).select(); }

  async copyLink() {
    try {
      await navigator.clipboard.writeText(this.internalLink());
      this.message.set('Enlace copiado. El acceso requiere una sesión de BUMI con permiso para ver esta cotización.');
      this.manualLink.set(false);
    } catch { this.manualLink.set(true); }
  }
  private download(url: string, filename = this.name()) {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
  }
  async share() {
    const pdf = this.pdf();
    if (!pdf) return;
    const files = [new File([pdf.blob], this.name(), {type:'application/pdf'})];
    if (!navigator.canShare?.({files})) {
      this.download(pdf.url);
      this.message.set('PDF descargado. Puedes adjuntarlo en tu correo o en la aplicación que uses para compartir.');
      return;
    }
    try { await navigator.share({files, title:'Propuesta comercial BUMI'}); }
    catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        this.message.set('El dispositivo no pudo compartirlo. Puedes usar Descargar PDF.');
      }
    }
  }
  async openMail() {
    const pdf = this.pdf();
    if (!pdf || this.preparingMail()) return;
    const filename = this.name();
    this.preparingMail.set(true);
    try {
      const draft = await quoteMail(pdf.blob, filename, pdf.email);
      if (this.pdf() !== pdf) return;
      const url = URL.createObjectURL(draft);
      this.download(url, filename.replace(/\.pdf$/, '.eml'));
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      this.message.set('Correo preparado con el PDF adjunto. Abre el archivo .eml en Outlook de escritorio o en otra aplicación compatible para revisar el destinatario y enviarlo.');
    } catch {
      this.message.set('No se pudo preparar el correo. Intenta de nuevo o usa Descargar PDF.');
    } finally {
      this.preparingMail.set(false);
    }
  }
}

