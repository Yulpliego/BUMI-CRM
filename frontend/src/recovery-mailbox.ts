import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from './api';

interface Mailbox {loginEmail:string;emails:string[];pending:string;available:boolean;demo:boolean;}

@Component({
  selector:'bumi-recovery-mailbox', imports:[FormsModule],
  template:`
    <section class="panel padded improvement">
      <h2>Correos de recuperación</h2>
      <p>Vincula las direcciones donde quieres recibir enlaces de recuperación. Puedes añadir Gmail, Outlook u otro proveedor.</p>
      @if (message) {<p class="error" role="alert">{{message}}</p>}
      @if (notice) {<p class="notice" role="status">{{notice}}</p>}
      @if (data; as box) {
        <div class="report-row"><span>Correo de inicio de sesión</span><strong>{{box.loginEmail}}</strong></div>
        @for (address of box.emails; track address) {
          <div class="report-row"><strong>{{address}}</strong><button type="button" class="text-button" (click)="removeAddress = address" [disabled]="busy">Quitar</button></div>
        }
        @if (removeAddress) {
          <form class="stack" (ngSubmit)="remove()">
            <label>Contraseña actual de BUMI para quitar {{removeAddress}}<input name="confirmation" [(ngModel)]="removePassword" type="password" autocomplete="current-password" required></label>
            <div class="actions"><button class="secondary danger" [disabled]="busy || !removePassword">Confirmar retiro</button>
              <button type="button" class="secondary" (click)="removeAddress = ''; removePassword = ''">Cancelar</button></div>
          </form>
        }
        @if (box.available) {
          @if (box.demo) {<p class="muted">Modo de prueba. El mensaje se guarda en el buzón local de BUMI.</p>}
          @if (box.pending) {
            <form class="stack" (ngSubmit)="confirm()">
              <label>Código enviado a {{box.pending}}
                <input name="code" [(ngModel)]="code" autocomplete="one-time-code" maxlength="12" required>
              </label>
              <button class="primary" [disabled]="busy || code.trim().length !== 12">Verificar correo</button>
            </form>
          }
          @if (box.emails.length < 4) {
          <details class="improvement" [open]="!box.emails.length && !box.pending">
            <summary>Vincular otro correo de recuperación</summary>
            <form class="form-grid" (ngSubmit)="begin()">
              <label>Correo que recibirá los enlaces<input name="email" [(ngModel)]="email" autocomplete="email" type="email" maxlength="160" required></label>
              <label>Contraseña actual de BUMI<input name="password" [(ngModel)]="password" autocomplete="current-password" type="password" required></label>
              <div class="form-actions"><button class="primary" [disabled]="busy || !email || !password">Enviar código de verificación</button></div>
            </form>
          </details>
          }
        } @else {<p class="muted">El servicio de correo todavía no está configurado.</p>}
      }
    </section>
  `
})
export class RecoveryMailboxPanel {
  api = inject(Api);
  data?:Mailbox;
  email = '';
  password = '';
  code = '';
  removeAddress = '';
  removePassword = '';
  busy = false;
  notice = '';
  message = '';
  async ngOnInit() {
    try { await this.load(); }
    catch (error) { this.message = errorText(error); }
  }
  private async load() { this.data = await this.api.get<Mailbox>('auth/recovery/mailbox'); }

  async begin() {
    const password = this.password;
    this.password = '';
    await this.submit('auth/recovery/mailbox', {email:this.email,password}, 'Código enviado. Revísalo e ingrésalo aquí.');
  }

  async remove() {
    const email = this.removeAddress;
    const password = this.removePassword;
    this.removePassword = '';
    await this.submit('auth/recovery/mailbox/quitar', {email,password}, 'Correo de recuperación retirado.');
    if (!this.message) this.removeAddress = '';
  }

  async confirm() {
    const code = this.code;
    this.code = '';
    await this.submit('auth/recovery/mailbox/confirm', {code}, 'Ya puedes recibir enlaces de recuperación en este correo.');
  }

  private async submit(path:string, body:unknown, notice:string) {
    if (this.busy) return;
    this.busy = true;
    this.message = this.notice = '';
    try { await this.api.send('POST',path,body); await this.load(); this.notice = notice; }
    catch (error) { this.message = errorText(error); }
    finally { this.busy = false; }
  }
}
