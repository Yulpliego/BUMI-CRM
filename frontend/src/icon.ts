import { Component, input } from '@angular/core';

const paths = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  inicio: 'm3 11 9-7 9 7M5 10v10h5v-6h4v6h5V10',
  clientes: 'M16 20H4v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2ZM20 20v-2a4 4 0 0 0-3-3.9M13 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3-2.8a3 3 0 0 1 0 5.6',
  marketing: 'm4 10 12-5v14L4 14a2 2 0 0 1 0-4Zm2 5 2 5h3l-1.4-4M19 9l2-1m-2 8 2 1',
  cotizaciones: 'M6 3h8l4 4v14H6V3Zm8 0v5h4M9 12h6m-6 4h6',
  ventas: 'M4 8h16v13H4V8Zm4 0V5l1-2h6l1 2v3m-8 5h8',
  inventario: 'm3 7 9-4 9 4v10l-9 4-9-4V7Zm0 0 9 4 9-4m-9 4v10m-4.5-16 9 4',
  proveedores: 'M3 5h11v11H3V5Zm11 4h4l3 4v3h-7M8 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm12 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
  agenda: 'M4 5h16v15H4V5Zm0 5h16M8 3v4m8-4v4m-8 7h2m4 0h2m-8 3h2',
  historial: 'M4 9a8 8 0 1 1 1 9M4 4v5h5m3-2v5l3 2',
  notificaciones: 'M5 17h14l-2-3V9a5 5 0 0 0-10 0v5l-2 3Zm5 3a2 2 0 0 0 4 0',
  estadisticas: 'M4 4v16h16M8 16v-4m4 4V8m4 8v-6m4 6V6',
  seguridad: 'm12 3 7 3v5c0 4-3 7-7 10-4-3-7-6-7-10V6l7-3Zm-3 9 2 2 4-4',
  salir: 'M11 5H4v14h7m4-10 4 3-4 3m-6-3h10',
  asistente: 'm12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Zm6 1v4m-2-2h4',
  dinero: 'M12 3v18m4-14H9.5a2.5 2.5 0 0 0 0 5h5a2.5 2.5 0 0 1 0 5H8',
  conversion: 'M6 18 18 6M9 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm10 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
} as const;

export type IconName = keyof typeof paths;

@Component({
  selector: 'bumi-icon',
  host: { class: 'bumi-icon', 'aria-hidden': 'true' },
  template: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" focusable="false">
    <path [attr.d]="paths[name()]"></path>
  </svg>`,
})
export class BumiIcon {
  readonly name = input.required<IconName>();
  readonly paths = paths;
}

