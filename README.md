# BUMI

Proyecto integrador para una distribuidora mexicana de artículos de oficina, equipo de cómputo y consumibles. La aplicación integra la operación comercial, inventario, abastecimiento y seguridad con Angular 21, ASP.NET Core 10 y PostgreSQL 17. Los importes se muestran en pesos mexicanos.

## Ejecutar desde la terminal de Antigravity

Abre esta carpeta como proyecto y crea una terminal desde **Terminal → New Terminal**. Desde la raíz, ejecuta:

```powershell
.\Iniciar-CRM.cmd
```

Con BUMI detenido, ejecuta `.\Iniciar-CRM.cmd -CargarDemo` para cargar una sola vez la muestra ficticia de **Distribuidora Aurora** en la misma base PostgreSQL. La carga conserva las cuentas, sus factores de autenticación y los datos existentes. Busca el prefijo `AUR-` en Inventario y `Aurora` en Marketing.

En **Estadísticas**, los filtros de fecha y estado controlan las ventas y el responsable limita los datos a su cartera. **Analista IA** compara una tendencia lineal y un promedio reciente con meses completos del historial. Muestra el error de validación y permite simular de uno a tres meses con un ajuste manual.

### Herramientas nuevas por módulo

- **Inicio y Agenda.** Prioridades con motivo, actividades vencidas resueltas, motivos de reprogramación y horarios sugeridos por carga.
- **Clientes y Oportunidades.** Coincidencias de correo, teléfono o RFC, fusión revisada por gerencia y sugerencias de seguimiento.
- **Marketing.** Abre **Atribución comercial por campaña** para registrar la captación y consultar costo por prospecto, cotizaciones e importe atribuido.
- **Cotizaciones y Ventas.** En el detalle se muestran las versiones, aprobación de descuentos, entregas parciales y devoluciones por partida.
- **Inventario y Proveedores.** Consulta cobertura, condiciones y alternativas de compra desde los paneles superiores. Registra la entrada de inventario al recibir la orden aprobada.
- **Historial y Notificaciones.** Filtra eventos, revisa resúmenes con sus eventos de origen y ajusta prioridades, horario de silencio y escalamiento.
- **Estadísticas.** **Detalle y validación** muestra operaciones, pronósticos históricos frente a resultados reales y variaciones por responsable, producto y campaña según el rol.
- **Mi cuenta.** **Sesiones y llaves de acceso** muestra los dispositivos autenticados y permite revocar sus sesiones. Para configurar las llaves en desarrollo local, abre `http://localhost:5088/cuenta` en un navegador compatible. Verifica el acceso con contraseña y llave, app autenticadora o código de respaldo. Las sesiones creadas antes de la actualización deben iniciar sesión de nuevo.

La opción `-CargarDemo` también incorpora datos ficticios de captación, condiciones de proveedores y entregas de Aurora de forma idempotente.

El lanzador usa Node.js 24, .NET 10 y PostgreSQL portátil. Abre **http://127.0.0.1:5088** y conserva la terminal abierta. Usa Ctrl+C en la terminal que inició el servidor para detenerlo. Si vuelves a ejecutar el comando con el CRM activo, el lanzador abre la instancia existente. También puedes ejecutar la tarea **BUMI: iniciar local** desde **Terminal → Run Task**.

La cuenta de demostración de Windows es `admin@nexo.test` con contraseña `NexoDemo-2026!`. Las cuentas `gerencia@nexo.test`, `ventas@nexo.test` y `marketing@nexo.test` usan la misma contraseña inicial. Todos los registros son ficticios. Para configurar otra contraseña desde la primera ejecución, define la variable `DemoPassword` antes de crear la base.
Todos los roles requieren verificación en dos pasos. En el primer acceso, escanea el QR con una app autenticadora compatible con TOTP o agrega la clave manualmente. Después ingresa el código de seis dígitos en BUMI y guarda los códigos de respaldo. Si vuelves a iniciar antes de confirmar la vinculación, puedes usar la misma entrada de tu autenticador. La pantalla ofrece generar otro QR si necesitas reemplazarla. En accesos posteriores usa el código de la app o un código de respaldo disponible. Para recuperar la contraseña con códigos, ingresa un código de respaldo sin usar y luego elige una contraseña nueva. El código se consume al guardar la contraseña. Desde **Mi cuenta** puedes vincular otro teléfono y, si eres administrador, activar o desactivar cuentas del equipo.


El lanzador usa PostgreSQL en `127.0.0.1:55432` y la base `nexo_crm`. Los binarios y datos portátiles se guardan fuera de la carpeta de código, en la ruta `RuntimePath`. Para una instancia existente, define `ConnectionStrings__Crm` antes de ejecutar el lanzador. La cuenta debe tener permisos para crear tablas en la primera ejecución. El esquema inicial se crea mediante `EnsureCreated`. El arranque aplica una actualización idempotente para conservar los datos de la versión anterior y habilitar la verificación y la auditoría.

## Recuperación de contraseña por correo

**Prueba local.** Inicia con `.\Iniciar-CRM.cmd -BuzonDemo`. Solicita un enlace en **¿Olvidaste tu contraseña?** usando una cuenta de prueba. El buzón guarda el mensaje como archivo de correo en `RuntimePath\correo-recuperacion`. Protege esos archivos porque contienen enlaces de acceso de corta duración.

**Gmail en Windows.** Genera una [contraseña de aplicación de Google](https://support.google.com/accounts/answer/185833?hl=es) con la verificación en dos pasos activa. Ejecuta `.\Iniciar-CRM.cmd -ConfigurarGmail` en la carpeta del proyecto. La terminal recibe la clave de forma oculta y la guarda protegida para tu usuario de Windows. Después inicia BUMI sin `-BuzonDemo`. En **Mi cuenta → Correo de recuperación**, vincula y verifica la dirección que recibirá tus enlaces. La página de recuperación pide el correo de inicio de sesión y uno de los destinos verificados. Puedes vincular hasta cuatro direcciones, incluidas cuentas de Outlook. Gmail sigue enviando los mensajes si es el remitente configurado.

Si el enlace usa `127.0.0.1`, ábrelo en la misma computadora donde corre BUMI. Para abrirlo en otro dispositivo, configura un origen HTTPS accesible desde ese dispositivo mediante `RecoveryMail__PublicOrigin`.

**Otros proveedores SMTP.** Configura las variables de entorno del proceso antes de iniciar BUMI. Usa credenciales del proveedor mediante variables o un almacén de secretos. Las cuentas necesitan un correo que pueda recibir mensajes. Los dominios ficticios de Aurora y de demostración se usan en pruebas locales.

| Variable | Valor |
| --- | --- |
| `RecoveryMail__PublicOrigin` | Origen HTTPS que pueden abrir los destinatarios, sin ruta. Para desarrollo en la misma computadora acepta HTTP de loopback. |
| `RecoveryMail__Host` | Servidor SMTP compatible con STARTTLS. |
| `RecoveryMail__Port` | Puerto SMTP. El valor predeterminado es 587. |
| `RecoveryMail__From` | Remitente verificado por el proveedor. |
| `RecoveryMail__Username` y `RecoveryMail__Password` | Credenciales SMTP si el proveedor las requiere. |

Cada correo de recuperación incluye un enlace y un código. Caducan en 15 minutos y comparten un solo uso. Si el mensaje no llega, puedes solicitar otro después de dos minutos. El flujo restablece la contraseña. Al vincular otro teléfono, el autenticador anterior se conserva hasta confirmar el nuevo QR. La verificación en dos pasos sigue activa. En **Alternativas de acceso** puedes usar un código de respaldo o una llave registrada. El formulario **Usar mis códigos** conserva la recuperación con app autenticadora y código de respaldo.

## Ejecutar con Docker Compose

En Docker Desktop usa el modo de contenedores Linux. Si es tu primera ejecución, copia `.env.example` a `.env` y sustituye los valores de `POSTGRES_PASSWORD` y `DEMO_PASSWORD` antes de arrancar. Desde la raíz del repositorio:

```powershell
docker compose --env-file .env -f docker/compose.yaml up --build --wait
docker compose --env-file .env -f docker/compose.yaml ps
```

Abre [BUMI en Docker](http://127.0.0.1:8080). Inicia con `admin@nexo.test` o `gerencia@nexo.test` y la contraseña que configuraste como `DEMO_PASSWORD`. Cada cuenta vincula su propio autenticador en el primer acceso. La opción `BUMI_DEMO_ENABLED=true` carga los registros ficticios de Aurora. Docker guarda sus datos en una base independiente de la que usa el lanzador de Windows.

En **Docker Desktop → Containers**, expande **bumi-crm** para ver los tres servicios:

| Servicio | Función |
| --- | --- |
| `frontend` | Nginx sirve Angular y envía las solicitudes `/api/` al backend. Es el único puerto publicado, en la propia computadora. |
| `backend` | ASP.NET Core ejecuta autenticación, permisos y reglas del CRM. Usa la red de Compose para acceder a PostgreSQL. |
| `db` | PostgreSQL almacena registros y sesiones en el volumen `database`. El volumen `keys` conserva las claves de protección que usa la API. |

Cada servicio tiene una comprobación de salud. Para ver registros, usa `docker compose --env-file .env -f docker/compose.yaml logs --tail 40`. Para detener el sistema conservando datos, usa `docker compose --env-file .env -f docker/compose.yaml stop`. Puedes reactivarlo con el mismo comando `up`. El cambio de `DEMO_PASSWORD` se aplica al crear las cuentas iniciales en una base nueva.

Para activar el correo en Docker, configura las variables opcionales `RECOVERY_MAIL_*` en tu `.env` local y vuelve a ejecutar `up --wait`. Los valores guardados por el lanzador de Windows se configuran por separado. Esta configuración sirve para desarrollo local. Mantén `.env`, las credenciales SMTP y los datos de PostgreSQL fuera de Git.

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

Para comprobar el arranque, inicia el CRM y ejecuta `node scripts/verificar.mjs http://127.0.0.1:5088`. Para verificar también los cuatro roles y escribir registros de prueba, usa `BUMI_TEST_ENROLL=1` con una base desechable que tenga las cuentas de demostración recién creadas. En una cuenta ya vinculada, `BUMI_TEST_TOTP_KEY` permite probar el acceso sin volver a vincularla.


## Trabajo diario, abastecimiento y marketing

- **Inicio** reúne pendientes personales, avisos, oportunidades abiertas y cotizaciones que vencen en siete días. Los indicadores respetan los módulos habilitados y los permisos del usuario.
- **Oportunidades** muestra un tablero por etapa. Desde una tarjeta puedes abrir la ficha, cambiar de etapa o programar un seguimiento.
- **Agenda** ofrece una lista y un calendario semanal. Vincula actividades con clientes, prospectos, oportunidades o cotizaciones. Los responsables consultan sus pendientes y gerencia puede asignar tareas.
- **Historial** registra cambios comerciales y permite agregar comentarios, llamadas y reuniones. Los eventos guardados se consultan desde su ficha.
- **Notificaciones** incluye avisos de agenda, cotizaciones, oportunidades sin seguimiento y existencias bajas. Puedes abrir el registro y marcar el aviso como leído.
- **Inventario** permite dar de alta productos, fijar mínimos y registrar entradas, salidas y conteos. El catálogo está disponible en cotizaciones y ventas. Cuando registras una venta, BUMI valida y descuenta las partidas vinculadas. Al cancelarla, repone las cantidades registradas. Las partidas manuales se conservan para servicios o conceptos sin existencias.
- **Proveedores** mantiene el directorio y relaciona cada proveedor con los productos que suministra.
- En **Marketing**, el simulador proyecta los prospectos a partir de la tasa histórica de campañas finalizadas. Usa el [intervalo de Wilson](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm), muestra la base del cálculo y señala las muestras pequeñas. La estimación funciona localmente con los datos de BUMI.

Las cuentas de demostración `inventario@nexo.test` y `compras@nexo.test` usan la misma contraseña inicial que las demás cuentas de ejemplo. Deben vincular su propia app autenticadora.

## Demostración

1. Abre **Marketing** y revisa los contactos y prospectos de una campaña. Puedes editarla para asociar más registros.
2. En **Clientes y prospectos**, abre **Instituto Horizonte**. Revisa sus datos y su oportunidad.
3. En **Cotizaciones**, abre el borrador de Instituto Horizonte. Revisa las partidas, marca la cotización como enviada y luego como aceptada. Puedes usar **Imprimir** para guardarla como PDF desde el navegador.
4. Regresa a la ficha del prospecto y usa **Convertir en cliente**. La cotización y la oportunidad conservan su vínculo.
5. Vuelve al detalle de la cotización y elige **Registrar venta**. En **Ventas**, abre el nuevo folio y actualiza su estado.
6. En **Estadísticas**, aplica un filtro y revisa los importes, oportunidades y productos.
7. En **Mi cuenta**, el administrador puede cambiar su contraseña y activar o desactivar los módulos operativos. El cambio se guarda en PostgreSQL y la API también aplica el bloqueo.

## Alcance de esta entrega

Puedes registrar ventas a partir de una cotización aceptada o una venta directa autorizada por gerencia o administración. Los productos se capturan por partida en la cotización. La autenticación incluye inicio en dos pasos, cierre de sesión, cambio y recuperación de contraseña con códigos de respaldo. Los administradores pueden activar o desactivar cuentas. Las ventas directas están reservadas a gerencia y administración. El historial registra la autorización inicial y los cambios de estado nuevos.

`frontend/src` contiene las rutas, formularios y vistas en Angular. `backend` contiene los endpoints, permisos, reglas y persistencia. La aplicación se sirve en una sola dirección local para que Angular y la API compartan origen.
