import { Component, ElementRef, HostListener, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { catchError, map, of, startWith, switchMap, timer } from 'rxjs';
import { Api, labels } from './api';

interface Hit { module: string; id: number; title: string; detail: string; }
interface SearchState { query: string; hits: Hit[]; waiting?: boolean; failed?: boolean; }

@Component({
  selector: 'bumi-workspace-search', imports: [RouterLink], template: `
    <form class="workspace-search" role="search" (submit)="submit($event)">
      <label class="sr-only" for="workspace-query">Buscar en BUMI</label>
      <span class="workspace-search-icon" aria-hidden="true"></span>
      <input id="workspace-query" #field type="search" maxlength="80" autocomplete="off"
        placeholder="Buscar en BUMI…" (input)="query.set(field.value); open.set(true)"
        (focus)="open.set(true)" (keydown.escape)="open.set(false)" aria-controls="workspace-results">
      @if (open() && term().length >= 2) {
        <div class="workspace-results" id="workspace-results">
          @if (waiting()) { <p role="status">Buscando…</p> }
          @else if (result().failed) { <p role="status">No se pudo buscar. Vuelve a intentarlo.</p> }
          @else {
            @for (item of hits(); track item.module + item.id) {
              <a [routerLink]="path(item)" [queryParams]="params(item)" (click)="open.set(false)">
                <span><strong>{{item.title}}</strong><small>{{item.detail}}</small></span><small>{{labels[item.module]}}</small>
              </a>
            } @empty { <p role="status">No encontramos registros ni módulos con ese texto.</p> }
          }
        </div>
      }
    </form>
  `
})
export class WorkspaceSearch {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly api = inject(Api);
  private readonly host = inject(ElementRef<HTMLElement>);
  readonly labels = labels;
  readonly query = signal('');
  readonly term = computed(() => this.query().trim());
  readonly open = signal(false);
  readonly result = toSignal(toObservable(this.term).pipe(switchMap(query =>
    query.length < 2 ? of<SearchState>({ query, hits: [] }) : timer(250).pipe(
      switchMap(() => this.http.get<Hit[]>('/api/buscar', { params: { q: query } })),
      map((hits): SearchState => ({ query, hits })),
      catchError(() => of<SearchState>({ query, hits: [], failed: true })),
      startWith<SearchState>({ query, hits: [], waiting: true }),
    ))), { initialValue: { query: '', hits: [] } as SearchState });
  readonly waiting = computed(() => this.result().query !== this.term() || this.result().waiting);
  readonly hits = computed(() => {
    const term = this.term().toLocaleLowerCase('es-MX');
    const pages = [
      { module: 'inicio', title: 'Dashboard' }, { module: 'cuenta', title: 'Seguridad de la cuenta' },
      ...(this.api.manager ? [{ module: 'usuarios', title: 'Usuarios y permisos' }] : []),
      ...Object.entries(labels).filter(([key]) => this.api.enabled(key) || (key === 'oportunidades' && this.api.enabled('clientes')))
        .map(([module, title]) => ({ module, title })),
    ].filter(item => item.title.toLocaleLowerCase('es-MX').includes(term))
      .slice(0, 4).map(item => ({ ...item, id: 0, detail: 'Módulo' }));
    return [...pages, ...this.result().hits];
  });

  @HostListener('document:click', ['$event'])
  closeOutside(event: MouseEvent) { if (!this.host.nativeElement.contains(event.target as Node)) this.open.set(false); }

  path(item: Hit) { return item.module === 'oportunidades' ? ['/clientes', 'oportunidades'] : ['/', item.module]; }

  params(item: Hit) {
    if (!item.id) return {};
    return { [item.module === 'clientes' ? 'ficha' : 'id']: item.id, buscar: 1 };
  }

  submit(event: SubmitEvent) {
    event.preventDefault();
    const hit = !this.waiting() && this.hits()[0];
    if (!hit) return;
    this.open.set(false);
    void this.router.navigate(this.path(hit), { queryParams: this.params(hit) });
  }
}

