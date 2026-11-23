import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Api, errorText, labels } from './api';

interface Account { id: number; name: string; email: string; role: string; active: boolean; current: boolean; lastSession: string | null; }
interface Permissions { roles: string[]; modules: Record<string, string[]>; writers: Record<string, string[]>; }

@Component({
  template: `
    <section class="admin-page">
      <header class="workspace-heading">
        <div><h1>Administración de usuarios y permisos</h1><p>Consulta las cuentas del equipo y el acceso a los módulos por rol.</p></div>
      </header>
      @if (!canEdit) { <p class="notice">Modo consulta. Las cuentas y los permisos se modifican desde una cuenta de administración.</p> }
      @if (message()) { <p class="error" role="alert">{{message()}}</p> }
      @if (notice()) { <p class="notice" role="status">{{notice()}}</p> }
      @if (loading()) { <p role="status">Cargando usuarios y permisos…</p> }
      @if (permissions(); as rules) {
        <div class="admin-metrics">
          <article class="panel"><small>Total de usuarios</small><strong>{{accounts().length}}</strong></article>
          <article class="panel"><small>Activos</small><strong>{{activeCount()}} <small>{{portion(activeCount())}}</small></strong></article>
          <article class="panel"><small>Inactivos</small><strong>{{accounts().length - activeCount()}} <small>{{portion(accounts().length - activeCount())}}</small></strong></article>
          <article class="panel"><small>Roles asignados</small><strong>{{roleCount()}}</strong></article>
        </div>
        <section class="panel admin-table">
          <header class="table-head">
            <label><span class="sr-only">Buscar usuario</span><input #filter type="search" placeholder="Buscar nombre o correo" (input)="query.set(filter.value); page.set(1)"></label>
            <div class="actions">
              <label><span class="sr-only">Rol</span><select #roleFilter (change)="role.set(roleFilter.value); page.set(1)">
                <option value="">Todos los roles</option>@for (item of rules.roles; track item) { <option>{{item}}</option> }
              </select></label>
              <label><span class="sr-only">Estado</span><select #stateFilter (change)="state.set(stateFilter.value); page.set(1)">
                <option value="">Todos los estados</option><option value="active">Activos</option><option value="inactive">Inactivos</option>
              </select></label>
            </div>
          </header>
          <div class="table-scroll" tabindex="0" aria-label="Tabla de usuarios">
            <table>
              <thead><tr><th>Usuario</th><th>Rol asignado</th><th>Estado</th><th>Módulos habilitados</th><th>Último inicio de sesión</th>@if (canEdit) {<th>Acciones</th>}</tr></thead>
              <tbody>
                @for (account of visible(); track account.id) {
                  <tr>
                    <td><div class="admin-user"><span class="admin-initials" aria-hidden="true">{{initials(account.name)}}</span>
                      <div><strong>{{account.name}}</strong><small>{{account.email}}</small></div></div></td>
                    <td><span class="admin-role">{{account.role}}</span></td>
                    <td><span class="badge" [attr.data-status]="account.active ? 'Activo' : 'Inactivo'">{{account.active ? 'Activo' : 'Inactivo'}}</span></td>
                    <td><div class="admin-tags">
                      @if (account.active) {
                        @for (key of accessByRole()[account.role] || []; track key) { <span>{{labels[key]}}</span> }
                        @empty { <small>Sin módulos habilitados</small> }
                      } @else { <small>Acceso suspendido</small> }
                    </div></td>
                    <td>{{account.lastSession ? format(account.lastSession) : 'Sin registros'}}</td>
                    @if (canEdit) { <td>
                      @if (account.current) { <span class="muted">Tu cuenta</span> }
                      @else {
                        @if (deleting() === account.id) {
                          <div class="admin-role-form" role="group" [attr.aria-label]="'Confirmar eliminación de ' + account.name">
                            <small>Eliminar a {{account.name}} revoca su acceso. Su historial se conserva.</small>
                            <div class="actions">
                              <button class="secondary danger" type="button" [disabled]="busy()" (click)="deleteAccount(account)">Confirmar eliminación</button>
                              <button class="secondary" type="button" [disabled]="busy()" (click)="deleting.set(null)">Cancelar</button>
                            </div>
                          </div>
                        } @else if (editing() === account.id) {
                          <form class="admin-role-form" (submit)="saveRole(account, $event)">
                            <label><span class="sr-only">Rol de {{account.name}}</span>
                              <select #roleChoice [value]="selectedRole()" [disabled]="busy()" (change)="selectedRole.set(roleChoice.value)">
                                @for (item of rules.roles; track item) { <option [value]="item" [selected]="selectedRole() === item">{{item}}</option> }
                              </select>
                            </label>
                            <div class="actions">
                              <button class="primary" [disabled]="busy() || selectedRole() === account.role">Guardar</button>
                              <button class="secondary" type="button" [disabled]="busy()" (click)="editing.set(null)">Cancelar</button>
                            </div>
                          </form>
                        } @else {
                          <div class="actions">
                            <button class="text-button" type="button" [disabled]="busy()" (click)="editRole(account)">Editar rol</button>
                            <button class="secondary" type="button" [disabled]="busy()" (click)="toggleAccount(account)">
                              {{account.active ? 'Desactivar' : 'Activar'}}
                            </button>
                            <button class="secondary danger" type="button" [disabled]="busy()" (click)="confirmDelete(account)">Eliminar usuario</button>
                          </div>
                        }
                      }
                    </td> }
                  </tr>
                } @empty { <tr><td [attr.colspan]="canEdit ? 6 : 5" class="empty">No hay usuarios que coincidan con estos filtros.</td></tr> }
              </tbody>
            </table>
          </div>
          <footer class="admin-pagination"><span>{{filtered().length}} de {{accounts().length}} usuarios</span>
            @if (pageCount() > 1) {
              <div class="actions">
                <button class="secondary" type="button" [disabled]="page() === 1" (click)="page.set(page() - 1)">Anterior</button>
                <span>{{page()}} de {{pageCount()}}</span>
                <button class="secondary" type="button" [disabled]="page() >= pageCount()" (click)="page.set(page() + 1)">Siguiente</button>
              </div>
            }
          </footer>
        </section>

        <section class="panel admin-table">
          <header class="table-head"><div><h2>Matriz de permisos por rol</h2><p>Consulta los niveles de lectura, escritura y administración. Las acciones específicas dependen del módulo.</p></div></header>
          <div class="table-scroll" tabindex="0" aria-label="Matriz de acceso por rol">
            <table>
              <thead><tr><th>Módulo</th>@for (item of rules.roles; track item) { <th>{{item}}</th> }<th>Disponible</th></tr></thead>
              <tbody>@for (module of api.profile()?.modules; track module.key) {
                <tr><th scope="row">{{labels[module.key]}}</th>
                  @for (item of rules.roles; track item) {
                    @let permission = level(rules, module.key, item, module.enabled);
                    <td><span class="admin-permission" [attr.data-permission]="permission">{{permission}}</span></td>
                  }
                  <td>
                    @if (canEdit) {
                      <label class="admin-switch"><input type="checkbox" [checked]="module.enabled" [disabled]="busy()" (change)="toggleModule(module.key, $event)">
                        <span>{{module.enabled ? 'Sí' : 'No'}}</span><span class="sr-only">{{labels[module.key]}}</span>
                      </label>
                    } @else { {{module.enabled ? 'Sí' : 'No'}} }
                  </td>
                </tr>
              }</tbody>
            </table>
          </div>
        </section>
      }
    </section>
  `
})
export class UsersPage implements OnInit {
  readonly api = inject(Api);
  get canEdit() { return this.api.profile()?.role === 'Administrador'; }
  readonly labels = labels;
  readonly accounts = signal<Account[]>([]);
  readonly permissions = signal<Permissions | null>(null);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly message = signal('');
  readonly notice = signal('');
  readonly query = signal('');
  readonly role = signal('');
  readonly state = signal('');
  readonly page = signal(1);
  readonly editing = signal<number | null>(null);
  readonly deleting = signal<number | null>(null);
  readonly selectedRole = signal('');
  readonly size = 8;
  readonly activeCount = computed(() => this.accounts().filter(account => account.active).length);
  readonly roleCount = computed(() => new Set(this.accounts().map(account => account.role)).size);
  readonly filtered = computed(() => {
    const query = this.query().trim().toLocaleLowerCase('es-MX');
    return this.accounts().filter(account => (!this.role() || account.role === this.role()) &&
      (!this.state() || account.active === (this.state() === 'active')) &&
      [account.name, account.email, account.role].some(text => text.toLocaleLowerCase('es-MX').includes(query)));
  });
  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.filtered().length / this.size)));
  readonly visible = computed(() => this.filtered().slice((this.page() - 1) * this.size, this.page() * this.size));
  readonly accessByRole = computed(() => {
    const rules = this.permissions();
    const enabled = this.api.profile()?.modules.filter(item => item.enabled) ?? [];
    return Object.fromEntries((rules?.roles ?? []).map(role => [role, enabled
      .filter(item => rules?.modules[item.key]?.includes(role)).map(item => item.key)]));
  });

  async ngOnInit() {
    try {
      const [accounts, permissions] = await Promise.all([this.api.get<Account[]>('config/accounts'), this.api.get<Permissions>('config/permisos')]);
      this.accounts.set(accounts);
      this.permissions.set(permissions);
    } catch (error) { this.message.set(errorText(error)); }
    finally { this.loading.set(false); }
  }
  initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase(); }
  format(value: string) { return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
  portion(count: number) {
    return new Intl.NumberFormat('es-MX', { style: 'percent', maximumFractionDigits: 1 })
      .format(this.accounts().length ? count / this.accounts().length : 0);
  }
  level(rules: Permissions, key: string, role: string, enabled: boolean) {
    if (!rules.modules[key]?.includes(role)) return 'Sin acceso';
    if (!enabled) return 'Desactivado';
    if (!rules.writers[key]?.includes(role)) return 'Lectura';
    return role === 'Administrador' ? 'Administración' : 'Escritura';
  }
  editRole(account: Account) {
    this.deleting.set(null);
    this.editing.set(account.id);
    this.selectedRole.set(account.role);
    this.message.set('');
    this.notice.set('');
  }
  async saveRole(account: Account, event: SubmitEvent) {
    event.preventDefault();
    const role = this.selectedRole();
    if (this.busy() || !role || role === account.role) return;
    this.busy.set(true);
    this.message.set('');
    this.notice.set('');
    try {
      await this.api.send('PUT', 'config/accounts/' + account.id + '/rol', { role });
      this.accounts.update(rows => rows.map(row => row.id === account.id ? { ...row, role } : row));
      this.editing.set(null);
      this.page.set(Math.min(this.page(), this.pageCount()));
      this.notice.set('Rol actualizado. La cuenta deberá volver a iniciar sesión.');
    } catch (error) { this.message.set(errorText(error)); }
    finally { this.busy.set(false); }
  }
  confirmDelete(account: Account) {
    this.editing.set(null);
    this.deleting.set(account.id);
    this.message.set('');
    this.notice.set('');
  }
  async deleteAccount(account: Account) {
    if (this.busy() || this.deleting() !== account.id || account.current) return;
    this.busy.set(true);
    this.message.set('');
    this.notice.set('');
    try {
      await this.api.send('DELETE', 'config/accounts/' + account.id);
      this.accounts.update(rows => rows.filter(row => row.id !== account.id));
      this.deleting.set(null);
      this.page.set(Math.min(this.page(), this.pageCount()));
      this.notice.set('Usuario eliminado.');
    } catch (error) { this.message.set(errorText(error)); }
    finally { this.busy.set(false); }
  }
  async toggleAccount(account: Account) {
    if (this.busy()) return;
    this.busy.set(true);
    this.message.set('');
    this.notice.set('');
    try {
      await this.api.send('PUT', 'config/accounts/' + account.id, { active: !account.active });
      this.accounts.update(rows => rows.map(row => row.id === account.id ? { ...row, active: !row.active } : row));
      this.page.set(Math.min(this.page(), this.pageCount()));
      this.notice.set(account.active ? 'Cuenta desactivada.' : 'Cuenta activada.');
    } catch (error) { this.message.set(errorText(error)); }
    finally { this.busy.set(false); }
  }
  async toggleModule(key: string, event: Event) {
    const input = event.target as HTMLInputElement;
    const enabled = input.checked;
    this.busy.set(true);
    this.message.set('');
    this.notice.set('');
    try {
      await this.api.send('PUT', 'config/' + key, { enabled });
      this.api.profile.update(profile => profile && { ...profile, modules: profile.modules.map(module =>
        module.key === key ? { ...module, enabled } : module) });
      this.notice.set('Disponibilidad del módulo actualizada.');
    } catch (error) { input.checked = !enabled; this.message.set(errorText(error)); }
    finally { this.busy.set(false); }
  }
}
