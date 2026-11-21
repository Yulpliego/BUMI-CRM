# Nexo CRM

Proyecto integrador para una distribuidora mexicana de artículos de oficina, equipo de cómputo y consumibles. La versión de presentación reúne seis módulos en una aplicación Angular 21 con una API ASP.NET Core 10 y PostgreSQL 17. Los importes se muestran en pesos mexicanos.

## Ejecutar desde la terminal de Antigravity

Abre esta carpeta como proyecto y crea una terminal desde **Terminal → New Terminal**. Desde la raíz, ejecuta:

```powershell
.\Iniciar-CRM.cmd
```

El lanzador usa Node.js 24, .NET 10 y PostgreSQL portátil. Abre **http://127.0.0.1:5088** y conserva la terminal abierta. Usa Ctrl+C para detener la aplicación. También puedes ejecutar la tarea **Nexo CRM: iniciar local** desde **Terminal → Run Task**.

La cuenta de demostración es `admin@nexo.test` con contraseña `NexoDemo-2026!`. Las cuentas `gerencia@nexo.test`, `ventas@nexo.test` y `marketing@nexo.test` usan la misma contraseña inicial. Todos los registros son ficticios. Para configurar otra contraseña desde la primera ejecución, define la variable `DemoPassword` antes de crear la base.

El lanzador usa PostgreSQL en `127.0.0.1:55432` y la base `nexo_crm`. Los binarios y datos portátiles se guardan fuera de la carpeta de código, en la ruta `RuntimePath`. Para una instancia existente, define `ConnectionStrings__Crm` antes de ejecutar el lanzador. La cuenta debe tener permisos para crear tablas en la primera ejecución. El esquema inicial se crea mediante `EnsureCreated`. Los cambios posteriores al esquema deberán gestionarse con migraciones de EF Core.

## Ejecutar con Docker Compose

Con Docker Desktop iniciado y funcionando en modo de contenedores Linux, copia `.env.example` a `.env` si el archivo local no existe y configura las contraseñas. Ejecuta desde la raíz:

```powershell
docker compose --env-file .env -f docker/compose.yaml up --build
```

Abre **http://127.0.0.1:8080**. Docker crea su propia base de demostración en un volumen. Para detener los servicios y conservar los datos, usa `docker compose --env-file .env -f docker/compose.yaml down`. La configuración de ejemplo sirve para desarrollo local.

## Estructura y documentación

```text
CRM/
  backend/            API ASP.NET Core, Dockerfile y solicitudes de ejemplo
  docker/
    compose.yaml
    nginx/default.conf
  frontend/           Angular, Dockerfile y recursos web instalables
  mobile/             Aplicación Android y guía para el emulador
  docs/               Memoria técnica y evidencias por criterio
  scripts/            Prueba HTTP de la web y la API
  .github/workflows/  Integración al publicar el repositorio en GitHub
```

Consulta la [memoria técnica](docs/Memoria-tecnica.md) y la [guía de Android](mobile/README.md). En el navegador, la opción de instalar la aplicación web requiere un contexto seguro como HTTPS o localhost. La versión Android de prueba se conecta desde el emulador al servidor de Windows. Los dos clientes usan la misma API.

Para comprobar el arranque, inicia el CRM y ejecuta `node scripts/verificar.mjs http://127.0.0.1:5088`. En Docker usa el puerto 8080 y el valor de `DEMO_PASSWORD` de tu instalación.


## Demostración

1. Abre **Marketing** y revisa los contactos y prospectos de una campaña. Puedes editarla para asociar más registros.
2. En **Clientes y prospectos**, abre **Instituto Horizonte**. Revisa sus datos y su oportunidad.
3. En **Cotizaciones**, abre el borrador de Instituto Horizonte. Revisa las partidas, marca la cotización como enviada y luego como aceptada. Puedes usar **Imprimir** para guardarla como PDF desde el navegador.
4. Regresa a la ficha del prospecto y usa **Convertir en cliente**. La cotización y la oportunidad conservan su vínculo.
5. Vuelve al detalle de la cotización y elige **Registrar venta**. En **Ventas**, abre el nuevo folio y actualiza su estado.
6. En **Estadísticas**, aplica un filtro y revisa los importes, oportunidades y productos.
7. En **Mi cuenta**, el administrador puede cambiar su contraseña y activar o desactivar los módulos operativos. El cambio se guarda en PostgreSQL y la API también aplica el bloqueo.

## Alcance de esta entrega

Las ventas se registran a partir de cotizaciones aceptadas. Los productos se capturan por partida en la cotización. La autenticación incluye inicio, cierre y cambio de contraseña, con las cuentas de demostración precargadas. La recuperación por correo y la administración de cuentas quedan pendientes para una versión posterior.

`frontend/src` contiene las rutas, formularios y vistas en Angular. `backend` contiene los endpoints, permisos, reglas y persistencia. La aplicación se sirve en una sola dirección local para que Angular y la API compartan origen.
