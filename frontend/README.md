# Interfaz de Nexo CRM

`npm ci` instala las dependencias. `npm run build` genera el sitio en `dist/crm/browser`. Para editar con recarga automática, inicia el CRM en el puerto 5088 y ejecuta `npm start` desde esta carpeta. El proxy de desarrollo envía `/api` al backend y conserva el origen de las solicitudes en el navegador.

`src` contiene las vistas, rutas y cliente HTTP. `public` contiene el manifiesto y los recursos de instalación. El service worker se registra en la compilación optimizada. Las solicitudes de API requieren conexión.
