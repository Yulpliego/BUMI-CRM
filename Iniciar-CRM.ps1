param(
    [string]$RuntimePath = (Join-Path $PSScriptRoot '../../work'),
    [int]$WebPort = 5088,
    [int]$PostgresPort = 55432,
    [switch]$NoBrowser,
    [switch]$CargarDemo,
    [switch]$BuzonDemo,
    [switch]$ConfigurarGmail
)

$ErrorActionPreference = 'Stop'
$runtime = (New-Item -ItemType Directory -Force $RuntimePath).FullName
$url = "http://127.0.0.1:$WebPort"
$correoGmail = Join-Path $runtime 'gmail-recuperacion.clixml'

if ($ConfigurarGmail) {
    $remitente = (Read-Host 'Dirección Gmail que enviará los mensajes').Trim()
    try { $validado = [Net.Mail.MailAddress]::new($remitente).Address }
    catch { throw 'Escribe una dirección de correo válida.' }
    if ($validado -ne $remitente) { throw 'Escribe solo el correo del remitente.' }
    $clave = Read-Host 'Contraseña de aplicación de Google (entrada oculta)' -AsSecureString
    if ($clave.Length -lt 16) { throw 'Ingresa la contraseña de aplicación generada por Google.' }
    [Management.Automation.PSCredential]::new($remitente,$clave) | Export-Clixml -LiteralPath $correoGmail
    Write-Host 'Configuración de Gmail guardada. Se aplicará en el siguiente inicio normal de BUMI.'
    return
}

function Test-CrmReady {
    try {
        $health = Invoke-RestMethod "$url/api/health" -TimeoutSec 2
        if ($health.database -ne 'PostgreSQL') { return $false }
        $homePage = Invoke-WebRequest "$url/" -UseBasicParsing -TimeoutSec 2
        return $homePage.Content -match '<title>(BUMI|Nexo CRM)</title>'
    } catch {
        return $false
    }
}

function Open-RunningCrm {
    if ($CargarDemo -or $BuzonDemo) { throw 'Detén BUMI en la terminal que lo ejecuta antes de cambiar su configuración de arranque.' }
    Write-Host "BUMI ya está en ejecución en $url. Puedes usar la sesión que ya está abierta."
    if (-not $NoBrowser) { Start-Process $url }
}

if (Test-CrmReady) {
    Open-RunningCrm
    return
}

$launchLock = $null
try {
    $launchLock = [IO.File]::Open((Join-Path $runtime 'nexo-crm.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
} catch [IO.IOException] {
    if (Test-CrmReady) {
        Open-RunningCrm
        return
    }
    throw "Ya hay un arranque de BUMI en esta carpeta de trabajo. Revisa la terminal que lo inició."
}

$serverStarted = $false
try {
    if (Test-CrmReady) {
        Open-RunningCrm
        return
    }

    $probe = [Net.Sockets.TcpClient]::new()
    try {
        try { $probe.Connect([Net.IPAddress]::Loopback, $WebPort) }
        catch [Net.Sockets.SocketException] {
            if ($_.Exception.SocketErrorCode -ne [Net.Sockets.SocketError]::ConnectionRefused) { throw }
        }
        if ($probe.Connected) { throw "El puerto $WebPort está en uso. Revisa la terminal del proceso que lo ocupa." }
    } finally {
        $probe.Dispose()
    }

    $dotnet = Get-Command dotnet.exe -ErrorAction SilentlyContinue
    $dotnetPath = if ($dotnet) { $dotnet.Source } else { Join-Path $env:ProgramFiles 'dotnet/dotnet.exe' }
    if (-not (Test-Path $dotnetPath)) { throw 'Instala el SDK de .NET 10 para iniciar el CRM.' }
    $npm = (Get-Command npm.cmd -ErrorAction Stop).Source

    function Confirm-Command([string]$Message) {
        if ($LASTEXITCODE -ne 0) { throw $Message }
    }

    $env:DOTNET_CLI_HOME = $runtime
    $env:NUGET_PACKAGES = Join-Path $runtime 'nuget'
    $env:NUGET_HTTP_CACHE_PATH = Join-Path $runtime 'nuget-http'
    $env:NUGET_SCRATCH = Join-Path $runtime 'nuget-scratch'
    $env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
    $env:DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'
    $env:ASPNETCORE_ENVIRONMENT = 'Development'
    $env:CrmKeysPath = (New-Item -ItemType Directory -Force (Join-Path $runtime keys)).FullName
    if ($CargarDemo) { $env:BumiDemo__Enabled = 'true' }
    if ($BuzonDemo) {
        if ($env:RecoveryMail__Host) { throw 'Ya hay un servicio SMTP configurado. Inicia sin -BuzonDemo para usarlo.' }
        $env:RecoveryMail__PublicOrigin = $url
        $env:RecoveryMail__PickupDirectory = Join-Path $runtime 'correo-recuperacion'
        Write-Host ("Buzón local de prueba: " + $env:RecoveryMail__PickupDirectory)
    } elseif (-not $env:RecoveryMail__Host -and (Test-Path -LiteralPath $correoGmail)) {
        $cred = Import-Clixml -LiteralPath $correoGmail
        $env:RecoveryMail__Host = 'smtp.gmail.com'
        $env:RecoveryMail__Port = '587'
        $env:RecoveryMail__From = $cred.UserName
        $env:RecoveryMail__Username = $cred.UserName
        $env:RecoveryMail__Password = $cred.GetNetworkCredential().Password -replace '\s',''
        if (-not $env:RecoveryMail__PublicOrigin) { $env:RecoveryMail__PublicOrigin = $url }
        Remove-Item Env:RecoveryMail__PickupDirectory -ErrorAction SilentlyContinue
        Write-Host 'Envío de recuperación configurado con Gmail.'
    }
    if (-not $env:DemoPassword) { $env:DemoPassword = 'NexoDemo-2026!' }

    if (-not $env:ConnectionStrings__Crm) {
        $postgres = Join-Path $runtime 'pgsql/bin'
        if (-not (Test-Path (Join-Path $postgres 'postgres.exe'))) {
            $archive = Join-Path $runtime 'postgresql.zip'
            Write-Host 'Descargando PostgreSQL portátil...'
            & curl.exe -fsSL --retry 2 'https://get.enterprisedb.com/postgresql/postgresql-17.9-1-windows-x64-binaries.zip' -o $archive
            Confirm-Command 'No se pudo descargar PostgreSQL.'
            & tar.exe -xf $archive -C $runtime
            Confirm-Command 'No se pudo extraer PostgreSQL.'
            Remove-Item -LiteralPath $archive
        }

        $data = Join-Path $runtime 'pgdata'
        $secret = Join-Path $runtime 'postgres-password.txt'
        if (-not (Test-Path $secret)) {
            $bytes = New-Object byte[] 24
            $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
            try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
            [IO.File]::WriteAllText($secret, [Convert]::ToBase64String($bytes))
        }
        if (-not (Test-Path (Join-Path $data 'PG_VERSION'))) {
            & (Join-Path $postgres 'initdb.exe') -D $data -U nexo -A scram-sha-256 "--pwfile=$secret" --locale=C --encoding=UTF8
            Confirm-Command 'No se pudo inicializar PostgreSQL.'
        }
        $ctl = Join-Path $postgres 'pg_ctl.exe'
        & $ctl -D $data status | Out-Null
        if ($LASTEXITCODE -ne 0) {
            & $ctl -D $data -l (Join-Path $runtime 'postgres.log') -o "-h 127.0.0.1 -p $PostgresPort" -w start
            Confirm-Command 'No se pudo arrancar PostgreSQL. Consulta postgres.log.'
            $serverStarted = $true
        }

        $password = [IO.File]::ReadAllText($secret).Trim()
        $env:PGPASSWORD = $password
        $psql = Join-Path $postgres 'psql.exe'
        $databaseExists = & $psql -h 127.0.0.1 -p $PostgresPort -U nexo -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname = 'nexo_crm'"
        Confirm-Command 'No se pudo conectar a PostgreSQL en el puerto indicado.'
        if ($databaseExists -ne '1') {
            & (Join-Path $postgres 'createdb.exe') -h 127.0.0.1 -p $PostgresPort -U nexo nexo_crm
            Confirm-Command 'No se pudo crear la base de datos nexo_crm.'
        }
        Remove-Item Env:PGPASSWORD
        $env:ConnectionStrings__Crm = "Host=127.0.0.1;Port=$PostgresPort;Database=nexo_crm;Username=nexo;Password=$password"
    }

    $frontend = Join-Path $PSScriptRoot 'frontend'
    $backend = Join-Path $PSScriptRoot 'backend'
    Push-Location $frontend
    try {
        if (-not (Test-Path 'node_modules/@angular/cli/bin/ng.js')) {
            New-Item -ItemType Directory -Force node_modules/@angular,node_modules/@babel | Out-Null
            & $npm install --no-audit --no-fund --no-bin-links --cache (Join-Path $runtime npm-cache)
            Confirm-Command 'No se pudieron instalar las dependencias de Angular.'
        }
        $index = Get-Item 'dist/crm/browser/index.html' -ErrorAction SilentlyContinue
        $inputs = @(Get-ChildItem src,public -Recurse -File) + @(Get-Item package.json,package-lock.json,angular.json,tsconfig.json)
        if (-not $index -or ($inputs | Where-Object LastWriteTimeUtc -GT $index.LastWriteTimeUtc)) {
            & $npm run build
            Confirm-Command 'Fallo la compilacion de Angular.'
        }
    } finally { Pop-Location }

    $static = New-Item -ItemType Directory -Force (Join-Path $backend 'wwwroot')
    Copy-Item -Path (Join-Path $frontend 'dist/crm/browser/*') -Destination $static.FullName -Recurse -Force

    & $dotnetPath restore $backend --configfile (Join-Path $PSScriptRoot 'NuGet.Config')
    Confirm-Command 'No se pudieron restaurar las dependencias de .NET.'
    $apiOutput = Join-Path $runtime 'backend-run'
    & $dotnetPath build $backend --no-restore --output $apiOutput
    Confirm-Command 'Falló la compilación del backend.'

    Write-Host "Iniciando BUMI en $url. Usa Ctrl+C para detenerlo."
    $browserJob = $null
    if (-not $NoBrowser) {
        $browserJob = Start-Job -ArgumentList $url -ScriptBlock {
            param($address)
            for ($attempt = 0; $attempt -lt 45; $attempt++) {
                try {
                    $response = Invoke-WebRequest "$address/api/health" -UseBasicParsing -TimeoutSec 2
                    if ($response.StatusCode -eq 200) { Start-Process $address; return }
                } catch { }
                Start-Sleep -Seconds 1
            }
        }
    }
    Push-Location $backend
    try {
        & $dotnetPath (Join-Path $apiOutput 'NexoCrm.Api.dll') --urls $url
        Confirm-Command 'No se pudo iniciar la API.'
    } finally {
        Pop-Location
        if ($browserJob) { Remove-Job -Job $browserJob -Force }
    }
} finally {
    try { if ($serverStarted) { & $ctl -D $data -m fast -w stop } }
    finally { $launchLock.Dispose() }
}
