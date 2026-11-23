import { Component, inject, isDevMode, provideZoneChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ActivatedRouteSnapshot, BaseRouteReuseStrategy, RouteReuseStrategy, Router, RouterOutlet, provideRouter } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api, errorText, sessionInterceptor } from './api';
import { Shell } from './shell';
import { UsersPage } from './users';
import { DashboardPage } from './stats';
import { PartiesPage } from './parties';
import { MarketingPage } from './marketing';
import { QuotesPage, SalesPage } from './commerce';

import { LoginPage } from './login';
import { SessionTools } from './session-tools';
import { RecoveryMailboxPanel } from './recovery-mailbox';
import { AgendaPage, HistoryPage, NoticesPage, PipelinePage } from './workbench';
import { HomePage } from './home';
import { InventoryPage, SuppliersPage } from './stock';

@Component({
  imports: [FormsModule, SessionTools, RecoveryMailboxPanel],
  template: `
    <div class="security-page">
      <header class="workspace-heading"><div><h1>Seguridad de la cuenta</h1><p>Revisa tus sesiones y administra los teléfonos de verificación.</p></div></header>
      @if (message) { <p class="error" role="alert">{{message}}</p> }
      <bumi-session-tools />
      <section class="panel security-card">
        <header class="security-card-heading"><div><h2>Verificación en dos pasos</h2>
          <p>Vincula un segundo teléfono con su propio código de seis dígitos. El teléfono principal sigue funcionando.</p></div>
        </header>
        <div class="security-form">
          <p>Si otra persona tiene autorización para usar esta cuenta, puede iniciar sesión con el mismo correo y contraseña y verificar el acceso desde su teléfono. Ambos tendrán el mismo rol y las acciones se registrarán bajo la misma cuenta.</p>
          @if (phones) {
            <p><strong>Teléfonos vinculados:</strong> {{phones.additional ? '2' : phones.linked ? '1' : '0'}}</p>
            @if (phones.linked) {
              <form class="stack" (ngSubmit)="managePhone()">
                <label>Confirma tu contraseña<input type="password" name="phonePassword" [(ngModel)]="password" autocomplete="current-password" required></label>
                @if (phones.additional) {
                  <p class="muted">Al retirar el segundo teléfono se cerrarán las sesiones de la cuenta.</p>
                }
                <button class="secondary" [disabled]="busy || !password">{{phones.additional ? 'Retirar segundo teléfono' : 'Agregar otro teléfono'}}</button>
              </form>
            }
          }
        </div>
      </section>
      <bumi-recovery-mailbox />
    </div>
  `
})
class AccountPage {
  readonly api = inject(Api);
  private readonly router = inject(Router);
  phones: { linked: boolean; additional: boolean } | null = null;
  password = '';
  busy = false;
  message = '';

  async ngOnInit() {
    try { this.phones = await this.api.get('auth/authenticator/phones'); }
    catch (error) { this.message = errorText(error); }
  }
  async managePhone() {
    if (this.busy || !this.password || !this.phones) return;
    this.busy = true;
    this.message = '';
    const remove = this.phones.additional;
    try {
      await this.api.send('POST', remove ? 'auth/authenticator/phones/remove' : 'auth/authenticator/reset',
        {password: this.password, addPhone: !remove});
      this.password = '';
      this.api.profile.set(null);
      this.api.loginMessage.set(remove ? 'Segundo teléfono retirado. Ingresa con tu autenticador principal.' :
        'Escanea el QR desde el teléfono adicional.');
      await this.router.navigateByUrl('/ingresar');
    } catch (error) { this.message = errorText(error); }
    finally { this.busy = false; }
  }
}


async function access(route: ActivatedRouteSnapshot) {
  const api = inject(Api);
  const router = inject(Router);
  if (!await api.restore()) return router.parseUrl('/ingresar');
  if ((route.data['managers'] && !api.manager) ||
      route.data['landing'] || (route.data['module'] && !api.enabled(route.data['module'])))
    return router.parseUrl(api.landing());
  return true;
}

async function anonymous() {
  const api = inject(Api);
  const router = inject(Router);
  return await api.restore() ? router.parseUrl(api.landing()) : true;
}

class SearchRouteReuse extends BaseRouteReuseStrategy {
  override shouldReuseRoute(next: ActivatedRouteSnapshot, current: ActivatedRouteSnapshot) {
    if ((next.queryParamMap.has('buscar') || current.queryParamMap.has('buscar')) &&
        next.routeConfig?.component !== Shell &&
        ['id', 'ficha'].some(key => next.queryParamMap.get(key) !== current.queryParamMap.get(key))) return false;
    return super.shouldReuseRoute(next, current);
  }
}

@Component({ selector: 'crm-root', imports: [RouterOutlet], template: '<router-outlet />' })
class App {}

bootstrapApplication(App, {
  providers: [
    provideZoneChangeDetection(),
    { provide: RouteReuseStrategy, useClass: SearchRouteReuse },
    provideHttpClient(withInterceptors([sessionInterceptor])),
    provideRouter([
      { path: 'ingresar', component: LoginPage, canActivate: [anonymous] },
      { path: 'recuperar', component: LoginPage, data: { access: 'email' } },
      { path: 'recuperar-con-codigos', component: LoginPage, data: { access: 'codes' } },
      { path: 'restablecer', component: LoginPage, data: { access: 'reset' } },
      { path: '', component: Shell, canActivate: [access], canActivateChild: [access], children: [
        { path: '', pathMatch: 'full', redirectTo: 'inicio' },
        { path: 'inicio', component: HomePage },
        { path: 'oportunidades', pathMatch: 'full', redirectTo: ({queryParams}) =>
          inject(Router).createUrlTree(['/clientes', 'oportunidades'], {queryParams}) },
        { path: 'agenda', data: {module: 'agenda'}, component: AgendaPage },
        { path: 'historial', data: {module: 'historial'}, component: HistoryPage },
        { path: 'notificaciones', data: {module: 'notificaciones'}, component: NoticesPage },
        { path: 'inventario', data: {module: 'inventario'}, component: InventoryPage },
        { path: 'proveedores', data: {module: 'proveedores'}, component: SuppliersPage },
        { path: 'estadisticas', data: {module: 'estadisticas'}, component: DashboardPage },
        { path: 'analista', data: {module: 'estadisticas', analyst: true}, component: DashboardPage },
        { path: 'clientes/oportunidades', data: {module: 'clientes'}, component: PipelinePage },
        { path: 'clientes', data: {module: 'clientes'}, component: PartiesPage },
        { path: 'marketing', data: {module: 'marketing'}, component: MarketingPage },
        { path: 'cotizaciones', data: {module: 'cotizaciones'}, component: QuotesPage },
        { path: 'ventas', data: {module: 'ventas'}, component: SalesPage },
        { path: 'cuenta', component: AccountPage },
        { path: 'usuarios', data: {managers:true}, component: UsersPage },
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
