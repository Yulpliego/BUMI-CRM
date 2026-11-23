import { Component, inject } from '@angular/core';
import { Api, errorText } from './api';

interface ActiveSession {id:string; device:string; current:boolean; started:string; expires:string;}
@Component({
  selector:'bumi-session-tools', template:`
    @if (message) { <p class="error" role="alert">{{message}}</p> }
    @if (notice) { <p class="notice" role="status">{{notice}}</p> }

    <section class="panel security-card" aria-labelledby="session-title">
      <header class="security-card-heading"><div><h2 id="session-title">Sesiones activas</h2><p>Dispositivos con sesión iniciada en tu cuenta.</p></div>
        @if (!loading) { <span class="security-count">{{sessions.length}} {{sessions.length === 1 ? 'sesión activa' : 'sesiones activas'}}</span> }
      </header>
      @for (session of sessions; track session.id) {
        <div class="security-row">
          <span class="security-icon" aria-hidden="true">{{mobile(session.device) ? '▯' : '▱'}}</span>
          <div class="security-row-title">
            <strong>{{device(session.device)}}</strong>
            @if (session.current) { <span class="badge" data-status="Activo">Esta sesión</span> }
            <small>Inicio {{format(session.started)}} · Expira {{format(session.expires)}}</small>
          </div>
          @if (!session.current) { <button class="secondary" type="button" [disabled]="busy" (click)="revoke(session.id)">Cerrar sesión remota</button> }
        </div>
      } @empty {
        <p class="security-empty">{{loading ? 'Cargando sesiones…' : 'No hay sesiones para mostrar.'}}</p>
      }
      @if (hasOtherSessions) {
        <footer class="security-footer">
          @if (confirmOthers) {
            <span>Los demás dispositivos tendrán que volver a iniciar sesión.</span>
            <button class="secondary" type="button" [disabled]="busy" (click)="confirmOthers = false">Cancelar</button>
            <button class="secondary danger" type="button" [disabled]="busy" (click)="revokeOthers()">Confirmar cierre</button>
          } @else {
            <button class="text-button security-danger" type="button" [disabled]="busy" (click)="confirmOthers = true">Cerrar todas las demás sesiones</button>
          }
        </footer>
      }
    </section>


  `
})
export class SessionTools {
  api = inject(Api);
  sessions:ActiveSession[] = [];
  loading = true;
  confirmOthers = false;
  get hasOtherSessions() { return this.sessions.some(item => !item.current); }
  mobile(agent:string) { return /Android|iPhone|iPad/.test(agent); }
  busy = false;
  message = '';
  notice = '';
  async ngOnInit() { await this.load(); }
  async load() {
    try {
      this.sessions = await this.api.get<ActiveSession[]>('auth/sesiones');
    } catch (error) { this.message = errorText(error); }
    finally { this.loading = false; }
  }
  format(value:string) {return new Intl.DateTimeFormat('es-MX',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));}
  device(agent:string) {
    const family = /Edg\//.test(agent) ? 'Edge' : /Chrome\//.test(agent) ? 'Chrome' : /Firefox\//.test(agent) ? 'Firefox' : /Safari\//.test(agent) ? 'Safari' : 'Navegador';
    const system = /Android/.test(agent) ? 'Android' : /iPhone|iPad/.test(agent) ? 'iOS' : /Windows/.test(agent) ? 'Windows' : /Macintosh/.test(agent) ? 'macOS' : /Linux/.test(agent) ? 'Linux' : '';
    return system ? family + ' · ' + system : family;
  }
  async revoke(id:string) {await this.action(() => this.api.send('DELETE','auth/sesiones/'+id), 'Sesión cerrada.');}
  async revokeOthers() {
    await this.action(() => this.api.send('DELETE','auth/sesiones/otras'), 'Se cerraron las demás sesiones.');
    if (!this.message) this.confirmOthers = false;
  }
  private async action(request:()=>Promise<unknown>, notice:string) {
    if (this.busy) return;
    this.busy = true;
    this.message = this.notice = '';
    try {await request(); this.notice = notice; await this.load();}
    catch (error) {this.message = errorText(error);}
    finally {this.busy = false;}
  }
}
