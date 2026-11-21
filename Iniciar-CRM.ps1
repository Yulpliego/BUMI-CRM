param(
    [string]$RuntimePath = (Join-Path $PSScriptRoot '../../work'),
    [int]$WebPort = 5088,
    [int]$PostgresPort = 55432,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$runtime = (New-Item -ItemType Directory -Force $RuntimePath).FullName
$dotnet = Get-Command dotnet.exe -ErrorAction SilentlyContinue
$dotnetPath = if ($dotnet) { $dotnet.Source } else { Join-Path $env:ProgramFiles 'dotnet/dotnet.exe' }
if (-not (Test-Path $dotnetPath)) { throw 'Instala el SDK de .NET 10 para iniciar el CRM.' }
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source

function Confirm-Command([string]$Message) {
    if ($LASTEXITCODE -ne 0) { throw $Message }
}

$serverStarted = $false
$env:DOTNET_CLI_HOME = $runtime
$env:NUGET_PACKAGES = Join-Path $runtime 'nuget'
$env:NUGET_HTTP_CACHE_PATH = Join-Path $runtime 'nuget-http'
$env:NUGET_SCRATCH = Join-Path $runtime 'nuget-scratch'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$env:CrmKeysPath = (New-Item -ItemType Directory -Force (Join-Path $runtime keys)).FullName
if (-not $env:DemoPassword) { $env:DemoPassword = 'NexoDemo-2026!' }

try {
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
    & $dotnetPath build $backend --no-restore
    Confirm-Command 'Falló la compilación del backend.'

    $url = "http://127.0.0.1:$WebPort"
    Write-Host "Iniciando Nexo CRM en $url. Usa Ctrl+C para detenerlo."
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
        & $dotnetPath 'bin/Debug/net10.0/NexoCrm.Api.dll' --urls $url
        Confirm-Command 'No se pudo iniciar la API.'
    } finally {
        Pop-Location
        if ($browserJob) { Remove-Job -Job $browserJob -Force }
    }
} finally {
    if ($serverStarted) { & $ctl -D $data -m fast -w stop }
}
