import { inject, Injectable, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { firstValueFrom, tap } from 'rxjs';
import { Router } from '@angular/router';

export const labels: Record<string, string> = {
  inicio: 'Inicio', oportunidades: 'Oportunidades',
  estadisticas: 'Estadísticas', clientes: 'Clientes y prospectos', marketing: 'Marketing',
  cotizaciones: 'Cotizaciones', ventas: 'Ventas', agenda: 'Agenda', historial: 'Historial',
  notificaciones: 'Notificaciones', inventario: 'Inventario', proveedores: 'Proveedores'
};

export interface Profile {
  name: string;
  role: string;
  modules: { key: string; enabled: boolean }[];
}
export interface LoginChallenge { email: string; setup: { key: string; qr: string } | null; expiresAt: string; hasPasskey?: boolean; replacement?: boolean; addPhone?: boolean; }
export interface PartyOption { id: number; name: string; kind: string; }
export const currency = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
export const dateText = (date: string) => date
  ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(date))
  : '—';
export const dateInput = (offset = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Mexico_City', dateStyle: 'short' }).format(date);
};
export const folio = (prefix: string, id: number) => prefix + '-' + String(id).padStart(4, '0');
export function errorText(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.error?.message) return error.error.message;
    if (error.status === 401) return 'Revisa tus credenciales o inicia sesión de nuevo.';
    if (error.status === 403) return 'Tu rol o la configuración actual impiden esta acción.';
    if (error.status === 429) return 'Demasiados intentos. Espera un minuto y vuelve a intentar.';
    if (error.status === 0) return 'No se pudo conectar con el CRM.';
  }
  return 'No se pudo completar la operación. Vuelve a intentarlo.';
}

@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);
  readonly profile = signal<Profile | null>(null);
  readonly loginMessage = signal('');
  readonly unread = signal(0);
  private sessionRevision = 0;
  private pendingProfile?: Promise<Profile | null>;
  get<T>(path: string) { return firstValueFrom(this.http.get<T>('/api/' + path)); }
  send<T = void>(method: string, path: string, body: unknown = {}, timeout?: number) {
    return firstValueFrom(this.http.request<T>(method, '/api/' + path, { body, timeout }));
  }

  restore(): Promise<Profile | null> {
    const current = this.profile();
    if (current) return Promise.resolve(current);
    if (this.pendingProfile) return this.pendingProfile;
    const revision = this.sessionRevision;
    const request = this.get<Profile>('auth/me').then(profile => {
      if (revision === this.sessionRevision && !this.profile()) this.profile.set(profile);
      return this.profile();
    }).catch(error => {
      if (revision === this.sessionRevision && (!(error instanceof HttpErrorResponse) || error.status !== 401))
        this.loginMessage.set(errorText(error));
      return this.profile();
    }).finally(() => { if (this.pendingProfile === request) this.pendingProfile = undefined; });
    this.pendingProfile = request;
    return request;
  }

  clearSession(message = '') {
    this.sessionRevision++;
    this.pendingProfile = undefined;
    this.profile.set(null);
    this.unread.set(0);
    this.loginMessage.set(message);
  }

  async logout() {
    try { await this.send('POST', 'auth/logout', {}, 8000); }
    catch (error) {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) throw error;
    }
    this.clearSession();
    // Descarta también una verificación incompleta antes de cambiar de usuario.
    try { await this.send('DELETE', 'auth/challenge', {}, 2500); }
    catch { /* La sesión ya se cerró. */ }
  }

  async login(email: string, password: string) {
    const challenge = await this.send<LoginChallenge>('POST', 'auth/login', { email, password });
    this.loginMessage.set('');
    return challenge;
  }

  landing() { return '/inicio'; }

  async refreshNotices() {
    if (!this.enabled('notificaciones')) { this.unread.set(0); return; }
    const profile = this.profile();
    try {
      const notices = await this.get<{read: boolean; muted?: boolean}[]>('notificaciones');
      if (profile === this.profile()) this.unread.set(notices.filter(item => !item.read && !item.muted).length);
    } catch { if (profile === this.profile()) this.unread.set(0); }
  }

  enabled(key: string) { return this.profile()?.modules.some(m => m.key === key && m.enabled) ?? false; }
  get manager() { return ['Administrador', 'Gerente'].includes(this.profile()?.role || ''); }
}

export const sessionInterceptor: HttpInterceptorFn = (request, next) => {
  const api = inject(Api);
  const router = inject(Router);
  const profile = api.profile();
  const prepared = ['GET', 'HEAD'].includes(request.method) ? request
    : request.clone({ setHeaders: { 'X-Nexo-Request': '1' } });
  return next(prepared).pipe(tap({ error: (error: HttpErrorResponse) => {
    if (error.status === 401 && profile && api.profile() === profile && request.url !== '/api/auth/logout') {
      api.clearSession('Tu sesión terminó. Ingresa nuevamente.');
      void router.navigateByUrl('/ingresar', {replaceUrl: true});
    }
  }}));
};
