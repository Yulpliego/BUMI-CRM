import { inject, Injectable, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { firstValueFrom, tap } from 'rxjs';
import { Router } from '@angular/router';

export const labels: Record<string, string> = {
  estadisticas: 'Estadísticas', clientes: 'Clientes y prospectos', marketing: 'Marketing',
  cotizaciones: 'Cotizaciones', ventas: 'Ventas'
};

export interface Profile {
  name: string;
  role: string;
  modules: { key: string; enabled: boolean }[];
}
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
  get<T>(path: string) { return firstValueFrom(this.http.get<T>('/api/' + path)); }
  send<T = void>(method: string, path: string, body: unknown = {}) {
    return firstValueFrom(this.http.request<T>(method, '/api/' + path, { body }));
  }

  async restore() {
    if (this.profile()) return this.profile();
    try { this.profile.set(await this.get<Profile>('auth/me')); }
    catch (error) {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401)
        this.loginMessage.set(errorText(error));
    }
    return this.profile();
  }

  async login(email: string, password: string) {
    this.profile.set(await this.send<Profile>('POST', 'auth/login', { email, password }));
    this.loginMessage.set('');
  }

  landing() {
    return '/' + (['estadisticas', 'clientes', 'cotizaciones', 'ventas', 'marketing']
      .find(key => this.enabled(key)) || 'cuenta');
  }

  enabled(key: string) { return this.profile()?.modules.some(m => m.key === key && m.enabled) ?? false; }
  get manager() { return ['Administrador', 'Gerente'].includes(this.profile()?.role || ''); }
}

export const sessionInterceptor: HttpInterceptorFn = (request, next) => {
  const api = inject(Api);
  const router = inject(Router);
  const prepared = ['GET', 'HEAD'].includes(request.method) ? request
    : request.clone({ setHeaders: { 'X-Nexo-Request': '1' } });
  return next(prepared).pipe(tap({ error: (error: HttpErrorResponse) => {
    if (error.status === 401 && api.profile()) {
      api.profile.set(null);
      api.loginMessage.set('Tu sesión terminó. Ingresa nuevamente.');
      void router.navigateByUrl('/ingresar');
    }
  }}));
};
