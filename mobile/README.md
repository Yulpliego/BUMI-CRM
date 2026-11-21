# Nexo CRM para Android

Abre `mobile` como proyecto en Android Studio y usa JDK 17 o 21 y Android SDK 34. Para generar el APK desde PowerShell en la raíz del proyecto:

```powershell
Set-Location .\mobile
.\gradlew.bat :app:assembleDebug
```

El APK se genera en `app/build/outputs/apk/debug/app-debug.apk`. Inicia el CRM en Windows y ejecuta el APK con el emulador. La dirección predeterminada es `http://10.0.2.2:5088`. Si vas a mostrar la versión de Docker, cambia el puerto a `8080` en el botón **Servidor** de la aplicación.

Para demostrar desde un teléfono Android conectado por USB con depuración autorizada, ejecuta `adb reverse tcp:5088 tcp:5088` y configura `http://127.0.0.1:5088` en el APK de prueba. El teléfono y la aplicación necesitan que el proceso del CRM siga corriendo en Windows. Para acceso por red, configura la dirección HTTPS del servidor en el botón **Servidor**. La compilación de publicación solo admite HTTPS.

En la demostración, inicia sesión desde Android, consulta una cotización y revisa la misma información en el navegador. Ambos clientes trabajan con los mismos datos de PostgreSQL.
