import { Component, HostListener, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Api, errorText, labels } from './api';
import { WorkspaceSearch } from './workspace-search';
import { BumiIcon, IconName } from './icon';

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive, WorkspaceSearch, BumiIcon],
  template: `
    <div class="shell portal-shell" [class.menu-expanded]="menuOpen()">
      <header class="portal-header no-print">
        <button class="portal-menu-toggle" type="button" (click)="toggleMenu()" [attr.aria-expanded]="menuOpen()"
          aria-controls="bumi-modules" [attr.aria-label]="menuOpen() ? 'Ocultar menú' : 'Mostrar menú'">
          <bumi-icon name="menu" />
        </button>
        <a class="portal-brand" [routerLink]="api.landing()"><span class="access-emblem" aria-hidden="true"></span><strong>BUMI</strong></a>
        <bumi-workspace-search />
        <div class="portal-actions">
          @if (api.enabled('notificaciones')) {
            <a class="notification-link" routerLink="/notificaciones" aria-label="Notificaciones">
              <bumi-icon name="notificaciones" />@if (api.unread()) { <small>{{api.unread()}}</small> }
            </a>
          }
          <div class="person">
            <span class="avatar" aria-hidden="true">{{initials()}}</span>
            <span class="person-name"><strong>{{api.profile()?.name}}</strong><small>{{api.profile()?.role}}</small></span>
          </div>
        </div>
      </header>
      @if (menuOpen()) {
        <button class="portal-overlay no-print" type="button" aria-label="Cerrar menú lateral" (click)="toggleMenu()"></button>
      }
      <nav class="portal-nav no-print" id="bumi-modules" aria-label="Módulos" [hidden]="!menuOpen()">
        <div class="portal-nav-modules">
          <a routerLink="/inicio" routerLinkActive="selected" ariaCurrentWhenActive="page"><bumi-icon name="inicio" />Inicio</a>
          @for (item of navigation; track item) {
            @if (api.enabled(item)) {
              <a [routerLink]="['/', item]" routerLinkActive="selected" ariaCurrentWhenActive="page"><bumi-icon [name]="item" />{{labels[item]}}</a>
            }
          }
          @if (api.enabled('estadisticas')) {
            <a routerLink="/analista" routerLinkActive="selected" ariaCurrentWhenActive="page"><bumi-icon name="asistente" />Analista IA</a>
          }
          @if (api.manager) {
            <a routerLink="/usuarios" routerLinkActive="selected" ariaCurrentWhenActive="page"><bumi-icon name="clientes" />Usuarios y permisos</a>
          }
          <a routerLink="/cuenta" routerLinkActive="selected" ariaCurrentWhenActive="page"><bumi-icon name="seguridad" />Seguridad de la cuenta</a>
        </div>
        <div class="portal-nav-account">
          <button class="portal-logout portal-logout-primary" type="button" (click)="logout()" [disabled]="busy"><bumi-icon name="salir" />{{busy ? 'Cerrando sesión…' : 'Cerrar sesión'}}</button>
          @if (message) { <p class="error" role="alert">{{message}}</p> }
        </div>
      </nav>
      <main class="content portal-content"><router-outlet /></main>
    </div>
  `
})
export class Shell {
  readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly viewport = window.matchMedia('(max-width: 840px)');
  readonly menuOpen = signal(!this.viewport.matches && this.desktopPreference());
  readonly labels = labels;
  readonly navigation: IconName[] = [
    'clientes', 'marketing', 'cotizaciones', 'ventas', 'inventario', 'proveedores',
    'agenda', 'historial', 'notificaciones', 'estadisticas',
  ];
  private narrow = this.viewport.matches;
  busy = false;
  message = '';

  constructor() {
    void this.api.refreshNotices();
    this.router.events.pipe(takeUntilDestroyed()).subscribe(event => {
      if (event instanceof NavigationEnd) {
        if (this.narrow) this.menuOpen.set(false);
        void this.api.refreshNotices();
      }
    });
  }

  @HostListener('window:resize')
  updateMenu() {
    if (this.narrow === this.viewport.matches) return;
    this.narrow = this.viewport.matches;
    this.menuOpen.set(!this.narrow && this.desktopPreference());
  }
  @HostListener('document:keydown.escape')
  closeMobile() { if (this.narrow) this.menuOpen.set(false); }

  toggleMenu() {
    this.menuOpen.update(open => !open);
    if (!this.narrow) {
      try { localStorage.setItem('bumi-menu-open', String(this.menuOpen())); }
      catch { /* La navegación funciona sin almacenamiento. */ }
    }
  }
  private desktopPreference() {
    try { return localStorage.getItem('bumi-menu-open') !== 'false'; }
    catch { return true; }
  }
  initials() { return this.api.profile()?.name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join(''); }

  async logout() {
    if (this.busy) return;
    this.busy = true;
    this.message = '';
    try {
      await this.api.logout();
      await this.router.navigateByUrl('/ingresar', {replaceUrl: true, state: {signedOut: true}});
    } catch (error) { this.message = 'No se pudo cerrar la sesión. ' + errorText(error); }
    finally { this.busy = false; }
  }
}

