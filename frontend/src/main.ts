import { Component, inject, isDevMode, provideZoneChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ActivatedRouteSnapshot, Router, RouterLink, RouterLinkActive, RouterOutlet, provideRouter } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api, errorText, labels, sessionInterceptor } from './api';
import { DashboardPage } from './stats';
import { PartiesPage } from './parties';
import { MarketingPage } from './marketing';
import { QuotesPage, SalesPage } from './commerce';

@Component({
  imports: [FormsModule],
  template: `
    <div class="login-wrap">
      <div class="login-art">
        <div class="brand"><span class="mark"><i></i><i></i><i></i><i></i></span><strong>Nexo<span>CRM</span></strong></div>
        <div><p class="eyebrow">GESTIÓN COMERCIAL</p><h1>De prospecto<br>a cliente.</h1>
        <p class="login-description">Organiza tus relaciones comerciales, da seguimiento a tus cotizaciones y consulta tus ventas en un solo lugar.</p></div>
        <div class="login-flow"><span>Prospecto</span><b></b><span>Cotización</span><b></b><span>Venta</span></div>
      </div>
      <main class="login-form">
        <form (ngSubmit)="login()">
          <p class="eyebrow">ESPACIO DE TRABAJO</p><h2>Inicia sesión</h2>
          <p class="muted">Ingresa con tu cuenta para acceder al CRM.</p>
          <label>Correo electrónico<input type="email" name="email" [(ngModel)]="email" autocomplete="username" required placeholder="correo@empresa.mx"></label>
          <label>Contraseña<input type="password" name="password" [(ngModel)]="password" autocomplete="current-password" required placeholder="Tu contraseña"></label>
          @if (message || api.loginMessage()) { <p class="error" role="alert">{{ message || api.loginMessage() }}</p> }
          <button class="primary" [disabled]="busy">{{ busy ? 'Ingresando…' : 'Iniciar sesión' }}</button>
        </form>
      </main>
    </div>
  `
})
class LoginPage {
  api = inject(Api);
  router = inject(Router);
  email = '';
  password = '';
  busy = false;
  message = '';
  async login() {
    if (this.busy) return;
    this.message = '';
    this.busy = true;
    try {
      await this.api.login(this.email, this.password);
      await this.router.navigateByUrl(this.api.landing());
    } catch (error) { this.message = errorText(error); }
    finally { this.busy = false; }
  }
}

@Component({
  imports: [FormsModule],
  template: `
    <header class="page-head"><div><p class="eyebrow">AUTENTICACIÓN</p><h1>Mi cuenta</h1><p>{{ api.profile()?.name }} · {{ api.profile()?.role }}</p></div></header>
    @if (message) { <p class="error" role="alert">{{message}}</p> }
    <div class="account-grid">
      <section class="panel padded">
        <h2>Cambiar contraseña</h2>
        <p class="muted">Al guardar, deberás iniciar sesión de nuevo.</p>
        <form class="stack" (ngSubmit)="change()">
          <label>Contraseña actual<input type="password" name="current" [(ngModel)]="current" required autocomplete="current-password"></label>
          <label>Nueva contraseña<input type="password" name="next" [(ngModel)]="next" minlength="12" maxlength="128" required autocomplete="new-password"></label>
          <button class="primary" [disabled]="busy">Guardar contraseña</button>
        </form>
      </section>
      @if (api.profile()?.role === 'Administrador') {
        <section class="panel padded">
          <h2>Configurar módulos</h2>
          <p class="muted">Activa o desactiva el acceso para todo el equipo.</p>
          @for (module of api.profile()?.modules; track module.key) {
            <label class="switch-row">{{ labels[module.key] }}
              <input type="checkbox" [checked]="module.enabled" [disabled]="busy" (change)="toggle(module.key, $event)">
            </label>
          }
          @if (notice) { <p class="notice" role="status">{{ notice }}</p> }
        </section>
      }
    </div>
  `
})
class AccountPage {
  api = inject(Api);
  router = inject(Router);
  labels = labels;
  current = '';
  next = '';
  busy = false;
  message = '';
  notice = '';
  async change() {
    this.busy = true;
    this.message = '';
    try {
      await this.api.send('POST', 'auth/password', {current: this.current, newPassword: this.next});
      this.api.profile.set(null);
      this.api.loginMessage.set('Contraseña actualizada. Ingresa con tu nueva contraseña.');
      await this.router.navigateByUrl('/ingresar');
    } catch (error) { this.message = errorText(error); }
    finally { this.busy = false; }
  }
  async toggle(key: string, event: Event) {
    const input = event.target as HTMLInputElement;
    const enabled = input.checked;
    this.busy = true;
    this.message = this.notice = '';
    try {
      await this.api.send('PUT', 'config/' + key, {enabled});
      this.api.profile.update(profile => profile && { ...profile, modules: profile.modules.map(module =>
        module.key === key ? {...module, enabled} : module) });
      this.notice = 'Configuración guardada.';
    } catch (error) { input.checked = !enabled; this.message = errorText(error); }
    finally { this.busy = false; }
  }
}

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="shell">
      <aside class="sidebar">
        <a class="brand" [routerLink]="api.landing()"><span class="mark"><i></i><i></i><i></i><i></i></span><strong>Nexo<span>CRM</span></strong></a>
        <p class="nav-label">OPERACIÓN</p>
        <nav aria-label="Módulos">
          @for (link of links; track link.key) {
            @if (api.enabled(link.key)) {
              <a [routerLink]="'/' + link.key" routerLinkActive="selected" ariaCurrentWhenActive="page"><span class="nav-icon" aria-hidden="true">{{ link.icon }}</span>{{ labels[link.key] }}</a>
            }
          }
        </nav>
        <div class="sidebar-bottom">
          <p class="nav-label">PREFERENCIAS</p>
          <a routerLink="/cuenta" routerLinkActive="selected" ariaCurrentWhenActive="page"><span class="nav-icon" aria-hidden="true">⚙</span>Mi cuenta</a>
          <button class="logout" (click)="logout()" [disabled]="busy"><span class="nav-icon" aria-hidden="true">↪</span>Cerrar sesión</button>
          @if (message) { <p class="side-error" role="alert">{{message}}</p> }
        </div>
      </aside>
      <div class="workspace">
        <div class="topbar"><span class="workspace-name">Espacio comercial</span>
          <span class="person"><span class="avatar">{{ initials() }}</span><span><strong>{{ api.profile()?.name }}</strong><small>{{ api.profile()?.role }}</small></span></span>
        </div>
        <main class="content"><router-outlet /></main>
      </div>
    </div>
  `
})
class Shell {
  api = inject(Api);
  router = inject(Router);
  labels = labels;
  links = [
    { key: 'estadisticas', icon: '▥' }, { key: 'clientes', icon: '◎' }, { key: 'marketing', icon: '◉' },
    { key: 'cotizaciones', icon: '▤' }, { key: 'ventas', icon: '▣' }
  ];
  busy = false;
  message = '';
  initials() { return this.api.profile()?.name.split(' ').slice(0, 2).map(x => x[0]).join(''); }
  async logout() {
    this.busy = true;
    try {
      await this.api.send('POST', 'auth/logout');
      this.api.profile.set(null);
      await this.router.navigateByUrl('/ingresar');
    } catch (error) { this.message = errorText(error); }
    finally { this.busy = false; }
  }
}

async function access(route: ActivatedRouteSnapshot) {
  const api = inject(Api);
  const router = inject(Router);
  if (!await api.restore()) return router.parseUrl('/ingresar');
  if (route.data['landing'] || (route.data['module'] && !api.enabled(route.data['module'])))
    return router.parseUrl(api.landing());
  return true;
}

async function anonymous() {
  const api = inject(Api);
  const router = inject(Router);
  return await api.restore() ? router.parseUrl(api.landing()) : true;
}

@Component({ selector: 'crm-root', imports: [RouterOutlet], template: '<router-outlet />' })
class App {}

bootstrapApplication(App, {
  providers: [
    provideZoneChangeDetection(),
    provideHttpClient(withInterceptors([sessionInterceptor])),
    provideRouter([
      { path: 'ingresar', component: LoginPage, canActivate: [anonymous] },
      { path: '', component: Shell, canActivate: [access], canActivateChild: [access], children: [
        { path: '', pathMatch: 'full', data: {landing: true}, component: AccountPage },
        { path: 'estadisticas', data: {module: 'estadisticas'}, component: DashboardPage },
        { path: 'clientes', data: {module: 'clientes'}, component: PartiesPage },
        { path: 'marketing', data: {module: 'marketing'}, component: MarketingPage },
        { path: 'cotizaciones', data: {module: 'cotizaciones'}, component: QuotesPage },
        { path: 'ventas', data: {module: 'ventas'}, component: SalesPage },
        { path: 'cuenta', component: AccountPage },
        { path: '**', redirectTo: '' }
      ]}
    ])
  ]
}).catch(console.error);

if (!isDevMode() && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(error => console.warn('No se pudo iniciar la vista sin conexión.', error));
  }, { once: true });
}
