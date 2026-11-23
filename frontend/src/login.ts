import { ChangeDetectorRef, Component, DestroyRef, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api, errorText, LoginChallenge, Profile } from './api';

@Component({
  imports: [FormsModule, RouterLink],
  template: `
    <div class="access-shell">
      <header class="access-header">
        <a class="access-brand" routerLink="/ingresar" aria-label="BUMI CRM"><span class="access-emblem" aria-hidden="true"></span><strong>BUMI</strong><span>CRM</span></a>
        <span class="access-header-note"><span aria-hidden="true">◈</span> Cuenta y seguridad</span>
      </header>
      <main class="access-main">
        @if (recoveryCodes.length) {
          <section class="access-card access-narrow">
            <span class="access-icon" aria-hidden="true">✓</span>
            <h1>Guarda tus códigos de respaldo</h1>
            <p>Podrás usarlos para entrar si pierdes acceso a tu app autenticadora. Cada código funciona una sola vez.</p>
            <ul class="backup-codes" aria-label="Códigos de respaldo">
              @for (item of recoveryCodes; track item) {<li><code>{{item}}</code></li>}
            </ul>
            <div class="access-stack">
              <button type="button" class="secondary" (click)="downloadCodes()">Descargar códigos</button>
              <button type="button" class="access-primary" (click)="enter()">Continuar a BUMI <span aria-hidden="true">→</span></button>
            </div>
          </section>
        } @else if (screen === 'email') {
          <section class="access-card access-narrow">
            <span class="access-icon" aria-hidden="true">↺</span>
            <p class="access-kicker">Recuperación de acceso</p>
            <h1>Recuperación de contraseña</h1>
            @if (sent) {
              <div class="access-info" role="status"><strong>Revisa tu correo</strong>
                @if (demoMail) {
                  <p>El modo de demostración guarda el correo en el buzón local de BUMI si la cuenta está activa.</p>
                } @else {
                  <p>Si el destino está verificado para esa cuenta, recibirás un correo con un enlace y un código de recuperación. Si no lo ves, revisa la carpeta de correo no deseado.</p>
                }
              </div>
              <div class="access-footer-link"><a routerLink="/restablecer" [state]="{loginEmail:email}">Ya tengo el código</a>
                <button type="button" class="access-link" (click)="sent = false">Cambiar destino o reenviar</button></div>
            } @else {
              <p>Escribe tu correo de inicio de sesión y el correo de recuperación verificado donde quieres recibir el enlace.</p>
              <form class="access-stack" (ngSubmit)="requestEmail()">
                <label>Correo de inicio de sesión<input type="email" name="email" [(ngModel)]="email" autocomplete="username" placeholder="correo@empresa.mx" required></label>
                <label>¿A qué correo enviamos el enlace?<input type="email" name="recipient" [(ngModel)]="recipient" autocomplete="email" placeholder="Ej. mi-correo@outlook.com" required></label>
                <small class="muted">Usa un correo que hayas verificado en Mi cuenta.</small>
                @if (message) {<p class="access-error" role="alert">{{message}}</p>}
                <button class="access-primary" [disabled]="busy || !email || !recipient">{{busy ? 'Solicitando…' : 'Enviar enlace de recuperación'}} <span aria-hidden="true">→</span></button>
              </form>
            }
            <div class="access-info"><strong>Enlace personal de un solo uso</strong><p>Caduca en 15 minutos. Si el correo no llega, puedes volver a solicitarlo después de dos minutos.</p></div>
            <div class="access-footer-link"><a routerLink="/ingresar">← Volver a iniciar sesión</a><a routerLink="/recuperar-con-codigos">Usar un código de respaldo</a></div>
          </section>
        } @else if (screen === 'reset' || (screen === 'codes' && backupValidated)) {
          <section class="access-card access-narrow">
            <span class="access-icon" aria-hidden="true">↺</span>
            <p class="access-kicker">Recuperación de acceso</p>
            <h1>Elige una contraseña nueva</h1>
            <p>Usa al menos 12 caracteres. Después de guardar, tendrás que iniciar sesión y verificar tu acceso.</p>
              <form class="access-stack" (ngSubmit)="resetPassword()">
                @if (screen === 'reset' && !token) {
                  <label>Correo de inicio de sesión<input name="email" type="email" [(ngModel)]="email" autocomplete="username" required></label>
                  <label>Código que recibiste por correo<input name="emailCode" [(ngModel)]="emailCode" autocomplete="one-time-code" maxlength="12" required></label>
                }
                <label>Nueva contraseña<input [type]="showPassword ? 'text' : 'password'" name="newPassword" [(ngModel)]="newPassword" autocomplete="new-password" minlength="12" maxlength="128" required></label>
                <label>Confirma la contraseña<input [type]="showPassword ? 'text' : 'password'" name="confirmation" [(ngModel)]="confirmation" autocomplete="new-password" maxlength="128" required></label>
                <label class="check"><input type="checkbox" name="show" [(ngModel)]="showPassword"> Mostrar contraseñas</label>
                @if (message) {<p class="access-error" role="alert">{{message}}</p>}
                <button class="access-primary" [disabled]="busy || newPassword.length < 12 || !confirmation || (screen === 'reset' && !token && (!email || emailCode.trim().length !== 12))">{{busy ? 'Guardando…' : 'Guardar contraseña'}} <span aria-hidden="true">→</span></button>
              </form>
            <div class="access-footer-link">
              <a routerLink="/ingresar">← Volver al inicio</a>
              @if (screen === 'codes') {
                <button type="button" class="access-link" (click)="clearBackup()" [disabled]="busy">Usar otro código</button>
              } @else {
                <a routerLink="/recuperar">Solicitar otro enlace</a>
              }
            </div>
          </section>
        } @else if (screen === 'codes') {
          <section class="access-card access-narrow">
            <span class="access-icon" aria-hidden="true">↺</span>
            <h1>Recuperación con códigos</h1>
            <p>Escribe uno de los códigos de respaldo que guardaste al configurar la verificación en dos pasos.</p>
            <form class="access-stack" (ngSubmit)="validateBackup()">
              <label>Código de respaldo<input name="backup" [(ngModel)]="backup" autocomplete="off" spellcheck="false" maxlength="36" placeholder="XXXXXX-XXXXXX-XXXXXX-XXXXXX" required></label>
              @if (message) {<p class="access-error" role="alert">{{message}}</p>}
              <button class="access-primary" [disabled]="busy || !backup.trim()">{{busy ? 'Verificando…' : 'Continuar'}}</button>
            </form>
            <div class="access-footer-link"><a routerLink="/recuperar">← Recuperar por correo</a></div>
          </section>
        } @else if (challenge; as current) {
          <section class="access-card access-narrow access-verification">
            <div class="access-verify-body">
              <span class="access-icon" aria-hidden="true">◈</span>
              <p class="access-kicker">Autenticación multifactor</p>
              <h1>Verificación en dos pasos</h1>
              @if (current.setup; as setup) {
                <p>{{current.addPhone ? 'Escanea el QR con el segundo teléfono y escribe el código que genere. El teléfono principal seguirá vinculado.' :
                  current.replacement ? 'Escanea el QR con el teléfono nuevo. Si cancelas, podrás seguir usando tu autenticador anterior.' :
                  'Escanea el QR con tu app autenticadora y escribe aquí el código de seis dígitos.'}}</p>
                <div class="access-qr"><img [src]="'data:image/png;base64,' + setup.qr" alt="Vincula BUMI con tu app autenticadora" width="144" height="144"></div>
                <details class="access-manual"><summary>Ingresar la clave manualmente</summary><code>{{setup.key}}</code></details>
                <button type="button" class="access-link" (click)="rotateSetup()" [disabled]="busy">Generar otro QR</button>
              } @else {
                <p>{{usingBackup ? 'Escribe uno de los códigos de respaldo que guardaste para tu cuenta.' : 'Escribe el código de seis dígitos de tu app autenticadora.'}}</p>
              }
              <form class="access-stack" (ngSubmit)="verify()">
                @if (usingBackup) {
                  <label>Código de respaldo<input name="backup" [(ngModel)]="code" autocomplete="off" maxlength="36" placeholder="XXXXXX-XXXXXX-XXXXXX-XXXXXX" required></label>
                } @else {
                  <label class="access-code-label">Código de verificación
                    <div class="access-code">
                      <input name="verifyCode" [ngModel]="code" (ngModelChange)="setOtp($event)"
                        inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" required>
                      <div class="access-code-boxes" aria-hidden="true">@for (index of digits; track index) {
                        <span [class.current]="index === code.length">{{code[index] || '·'}}</span>
                      }</div>
                    </div>
                  </label>
                  <small class="access-timer">El código de tu app cambia cada 30 segundos.</small>
                }
                @if (message) {<p class="access-error" role="alert">{{message}}</p>}
                <button class="access-primary" [disabled]="busy || !canVerify">{{busy ? 'Verificando…' : 'Verificar y acceder'}} <span aria-hidden="true">→</span></button>
              </form>
            </div>
            <div class="access-alternatives">
              @if (!current.setup) {
                <h2>Alternativas de acceso</h2>
                <div class="access-option-grid">
                  <button type="button" (click)="toggleBackup()" [disabled]="busy">
                    <span aria-hidden="true">▦</span><span><strong>{{usingBackup ? 'App autenticadora' : 'Código de respaldo'}}</strong>
                      <small>{{usingBackup ? 'Volver al código de seis dígitos' : 'Usar un código de un solo uso'}}</small></span>
                  </button>
                </div>
                <details class="access-help">
                  <summary>No tengo mi dispositivo ni un código de respaldo</summary>
                  <p>Contacta a la persona administradora de BUMI para que verifique tu identidad y te ayude a recuperar el acceso.</p>
                </details>
              }
              <button type="button" class="access-link access-back" (click)="cancelChallenge()" [disabled]="busy">← Volver al inicio de sesión</button>
            </div>
          </section>
        } @else {
          <div class="access-sign-in">
            <section class="access-story" aria-label="Identidad de BUMI">
              <div class="access-logo-frame"><img src="/bumi-identidad.png" alt="Logotipo de BUMI" width="1408" height="768"></div>
              <h2>Tu operación comercial, en un solo lugar</h2>
              <p>Da seguimiento a tus clientes, cotizaciones y ventas desde BUMI.</p>
              <div class="access-module-row" aria-label="Módulos disponibles"><span>Clientes</span><span>Cotizaciones</span><span>Ventas</span></div>
            </section>
            <section class="access-card access-login-card">
              <p class="access-kicker">Acceso corporativo</p>
              <h1>Inicia sesión en BUMI CRM</h1>
              <p>Ingresa con el correo y la contraseña de tu cuenta.</p>
              <form class="access-stack" (ngSubmit)="login()">
                <label>Correo electrónico<input type="email" name="email" [(ngModel)]="email" autocomplete="username" placeholder="correo@empresa.mx" required></label>
                <label>Contraseña
                  <span class="access-password"><input [type]="showPassword ? 'text' : 'password'" name="password" [(ngModel)]="password"
                    autocomplete="current-password" placeholder="Tu contraseña" required>
                    <button type="button" [attr.aria-pressed]="showPassword" (click)="showPassword = !showPassword">{{showPassword ? 'Ocultar' : 'Mostrar'}}</button></span>
                </label>
                <div class="access-recover-link"><a routerLink="/recuperar" [state]="email ? {loginEmail: email} : {}">¿Olvidaste tu contraseña?</a></div>
                @if (message) {<p class="access-error" role="alert">{{message}}</p>}
                @if (api.loginMessage()) {<p class="access-info" role="status">{{api.loginMessage()}}</p>}
                <button class="access-primary" [disabled]="busy || !email || !password">{{busy ? 'Comprobando…' : 'Iniciar sesión'}} <span aria-hidden="true">→</span></button>
              </form>
              <div class="access-info"><strong>Acceso con verificación en dos pasos</strong><p>Después de tu contraseña, verifica el acceso con tu app autenticadora o un código de respaldo.</p></div>
            </section>
          </div>
        }
      </main>
    </div>
  `
})
export class LoginPage {
  api = inject(Api);
  router = inject(Router);
  route = inject(ActivatedRoute);
  screen = this.route.snapshot.data['access'] ?? 'login';
  email = '';
  password = '';
  newPassword = '';
  confirmation = '';
  token = '';
  code = '';
  backup = '';
  backupValidated = false;
  busy = false;
  usingBackup = false;
  showPassword = false;
  sent = false;
  demoMail = false;
  recipient = '';
  emailCode = '';
  message = '';
  challenge: LoginChallenge | null = null;
  recoveryCodes: string[] = [];
  digits = [0, 1, 2, 3, 4, 5];
  private destroyed = false;
  private challengeCancelled = false;
  private changeDetector = inject(ChangeDetectorRef);

  constructor() {
    inject(DestroyRef).onDestroy(() => { this.destroyed = true; this.token = ''; });
  }

  async ngOnInit() {
    if (this.screen === 'reset') {
      this.email = typeof history.state?.loginEmail === 'string' ? history.state.loginEmail : '';
      const token = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
      if (/^[a-z0-9_-]{43}$/i.test(token)) this.token = token;
      if (window.location.hash) history.replaceState(history.state, '', window.location.pathname);
      return;
    }
    if (this.screen === 'email') {
      this.email = typeof history.state?.loginEmail === 'string' ? history.state.loginEmail : '';
      return;
    }
    if (this.screen !== 'login' || history.state?.signedOut === true) return;
    try {
      const current = await this.api.get<LoginChallenge | null>('auth/challenge');
      if (current && !this.destroyed && !this.challengeCancelled && !this.busy && !this.challenge) {
        this.challenge = current;
        this.email = current.email;
      }
    } catch (error) { this.message = errorText(error); }
  }
  async cancelChallenge() {
    this.challengeCancelled = true;
    this.back();
    this.api.loginMessage.set('');
    await this.run(async () => {
      await this.api.send('DELETE', 'auth/challenge', {}, 4000);
    });
  }
  async rotateSetup() {
    await this.run(async () => {
      try {
        this.challenge = await this.api.send<LoginChallenge>('POST', 'auth/challenge/rotate');
        this.code = '';
      } catch (error) {
        if (error instanceof HttpErrorResponse && error.status === 410) this.back();
        throw error;
      }
    });
  }
  get canVerify() {
    return this.usingBackup ? /^[0-9a-f]{6}(?:-?[0-9a-f]{6}){3}$/i.test(this.code.trim()) : /^[0-9]{6}$/.test(this.code);
  }
  async login() {
    await this.run(async () => {
      this.challenge = await this.api.login(this.email, this.password);
      this.password = '';
      this.showPassword = false;
      this.code = '';
    });
  }
  async verify() {
    if (!this.canVerify) return;
    await this.run(async () => {
      try {
        const result = await this.api.send<{profile: Profile; recoveryCodes: string[] | null}>('POST', 'auth/verify',
          {code:this.code.trim(),useRecovery:this.usingBackup});
        this.api.profile.set(result.profile);
        this.challenge = null;
        this.code = '';
        this.recoveryCodes = result.recoveryCodes || [];
        if (!this.recoveryCodes.length) await this.enter();
      } catch (error) {
        if (error instanceof HttpErrorResponse && error.status === 410) this.back();
        throw error;
      }
    });
  }
  async requestEmail() {
    await this.run(async () => {
      const delivery = await this.api.send<{demo: boolean}>('POST','auth/recovery/email',{email:this.email,recipient:this.recipient});
      this.demoMail = delivery.demo;
      this.sent = true;
    });
  }
  async resetPassword() {
    if (this.newPassword !== this.confirmation) { this.message = 'Las contraseñas deben coincidir.'; return; }
    await this.run(async () => {
      if (this.screen === 'codes') {
        await this.api.send('POST','auth/recovery/backup',{recoveryCode:this.backup.trim(),password:this.newPassword});
        this.clearBackup();
      } else {
        await this.api.send('POST','auth/recovery/reset',{token:this.token,password:this.newPassword,email:this.email,code:this.emailCode});
        this.token = '';
      }
      await this.returnAfterReset();
    });
  }
  async validateBackup() {
    const value = this.backup.trim();
    if (!value) return;
    await this.run(async () => {
      await this.api.send('POST','auth/recovery/backup',{recoveryCode:value});
      this.backup = value;
      this.backupValidated = true;
    });
  }
  clearBackup() {
    this.backup = this.newPassword = this.confirmation = this.message = '';
    this.backupValidated = this.showPassword = false;
  }
  private async returnAfterReset() {
    this.api.profile.set(null);
    this.api.loginMessage.set('Contraseña restablecida. Inicia sesión con tu nueva contraseña.');
    await this.router.navigateByUrl('/ingresar');
  }
  async enter() {
    this.recoveryCodes = [];
    await this.router.navigateByUrl(this.api.landing());
  }
  downloadCodes() {
    const contents = 'BUMI — Códigos de respaldo\n' + this.email + '\n\n' + this.recoveryCodes.join('\n');
    const url = URL.createObjectURL(new Blob([contents], {type:'text/plain;charset=utf-8'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'BUMI-codigos-de-respaldo.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  back() {
    this.challenge = null;
    this.usingBackup = this.showPassword = false;
    this.code = this.password = this.message = '';
  }
  setOtp(value:string) { this.code = value.replace(/[^0-9]/g,'').slice(0,6); }
  toggleBackup() { this.usingBackup = !this.usingBackup; this.code = this.message = ''; }
  private async run(action: () => Promise<void>) {
    if (this.busy) return;
    this.busy = true;
    this.message = '';
    try { await action(); }
    catch (error) { this.message = errorText(error); }
    finally {
      this.busy = false;
      if (!this.destroyed) this.changeDetector.detectChanges();
    }
  }
}
