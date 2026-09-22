$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$EnvFile = Join-Path $Root "deploy\.env.classroom"
$Compose = @("compose", "--env-file", $EnvFile, "-f", (Join-Path $Root "docker-compose.classroom.yml"))

function Heading($Text) { Write-Host "`n$Text" -ForegroundColor Cyan }
function SecureHex([int]$Bytes) { $buffer = New-Object byte[] $Bytes; $rng=[Security.Cryptography.RandomNumberGenerator]::Create(); try{$rng.GetBytes($buffer)}finally{$rng.Dispose()}; return ([BitConverter]::ToString($buffer)-replace '-','').ToLowerInvariant() }
function Select-LanIp {
  $addresses = @(Get-NetIPConfiguration | Where-Object { $_.NetAdapter.Status -eq "Up" -and $_.InterfaceAlias -notmatch "Docker|vEthernet|WSL|Loopback|Bluetooth|Virtual" } | ForEach-Object { $_.IPv4Address.IPAddress } | Where-Object { $_ -and $_ -notlike "127.*" -and $_ -notlike "169.254.*" } | Sort-Object -Unique)
  if ($addresses.Count -eq 0) { throw "No active LAN IPv4 address was found. Connect this computer to the classroom Wi-Fi and retry." }
  if ($addresses.Count -eq 1) { return $addresses[0] }
  Write-Host "Available LAN addresses:"
  for ($i=0; $i -lt $addresses.Count; $i++) { Write-Host "  $($i+1). $($addresses[$i])" }
  do { $choice = Read-Host "Select the classroom network [1-$($addresses.Count)]" } until ($choice -match '^\d+$' -and [int]$choice -ge 1 -and [int]$choice -le $addresses.Count)
  return $addresses[[int]$choice-1]
}
function Set-EnvValue([string[]]$Lines, [string]$Name, [string]$Value) {
  $found = $false
  $next = foreach ($line in $Lines) { if ($line -match "^$([regex]::Escape($Name))=") { $found=$true; "$Name=$Value" } else { $line } }
  if (-not $found) { $next += "$Name=$Value" }
  return @($next)
}
function Test-Url([string]$Url) { try { $response=Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 $Url; return $response.StatusCode -eq 200 } catch { return $false } }

Set-Location $Root
Heading "CARBON TRADER I - Classroom Launcher"
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker Desktop is not installed or docker is not on PATH." }
$previousPreference=$ErrorActionPreference; $ErrorActionPreference="SilentlyContinue"
& docker version *> $null; $dockerStatus=$LASTEXITCODE
& docker compose version *> $null; $composeStatus=$LASTEXITCODE
$ErrorActionPreference=$previousPreference
if ($dockerStatus -ne 0) { throw "Docker Desktop is installed but its daemon is not running. Start Docker Desktop and retry." }
if ($composeStatus -ne 0) { throw "Docker Compose v2 is required. Update Docker Desktop." }
Write-Host "Docker Desktop ............ OK"

$LanIp = Select-LanIp
$Port = if ($env:CLASSROOM_PORT_OVERRIDE) { $env:CLASSROOM_PORT_OVERRIDE } else { "8088" }
$ProjectName = if ($env:CLASSROOM_PROJECT_NAME) { $env:CLASSROOM_PROJECT_NAME } else { "carbon-trader-classroom" }
if (-not (Test-Path -LiteralPath $EnvFile)) {
  $dbSecret = SecureHex 32; $accessSecret = SecureHex 48; $refreshSecret = SecureHex 48
  $lines = @(
    "COMPOSE_PROJECT_NAME=$ProjectName", "CLASSROOM_PORT=$Port", "CLASSROOM_LAN_IP=$LanIp",
    "POSTGRES_USER=carbon", "POSTGRES_PASSWORD=$dbSecret", "POSTGRES_DB=carbon_trader",
    "DATABASE_URL=postgresql://carbon:$dbSecret@postgres:5432/carbon_trader?schema=public", "REDIS_URL=redis://redis:6379",
    "JWT_ACCESS_SECRET=$accessSecret", "JWT_REFRESH_SECRET=$refreshSecret", "CORS_ALLOWED_ORIGINS=http://${LanIp}:$Port",
    "NEXT_PUBLIC_API_URL=/v1", "ACCESS_TOKEN_TTL=15m", "REFRESH_TOKEN_TTL_DAYS=7", "PRESENCE_OFFLINE_SECONDS=30", "HEALTH_TIMEOUT_MS=1500",
    "ANDROID_APP_INSTALL_URL=", "ANDROID_APP_VERSION=", "IOS_APP_INSTALL_URL="
  )
  [IO.File]::WriteAllLines($EnvFile, $lines, [Text.UTF8Encoding]::new($false))
  Write-Host "Runtime configuration ....... Created with random secrets"
} else {
  $lines = Get-Content -LiteralPath $EnvFile
  $existingPort = ($lines | Where-Object { $_ -match '^CLASSROOM_PORT=' } | Select-Object -First 1) -replace '^CLASSROOM_PORT=',''
  if ($existingPort) { $Port = $existingPort }
  $lines = Set-EnvValue $lines "CLASSROOM_LAN_IP" $LanIp
  $lines = Set-EnvValue $lines "CORS_ALLOWED_ORIGINS" "http://${LanIp}:$Port"
  [IO.File]::WriteAllLines($EnvFile, $lines, [Text.UTF8Encoding]::new($false))
  Write-Host "Runtime configuration ....... Reused; LAN address refreshed"
}
$apk = Join-Path $Root "deploy\local-classroom\downloads\CarbonTrader.apk"
$appVersion = (Get-Content -Raw (Join-Path $Root "apps\mobile\package.json") | ConvertFrom-Json).version
$lines=Get-Content $EnvFile
if (Test-Path $apk) { $lines=Set-EnvValue $lines "ANDROID_APP_INSTALL_URL" "/downloads/CarbonTrader.apk"; $lines=Set-EnvValue $lines "ANDROID_APP_VERSION" $appVersion }
else { $lines=Set-EnvValue $lines "ANDROID_APP_INSTALL_URL" ""; $lines=Set-EnvValue $lines "ANDROID_APP_VERSION" "" }
[IO.File]::WriteAllLines($EnvFile,$lines,[Text.UTF8Encoding]::new($false))
Write-Host "LAN Address ................. $LanIp"

Heading "Building and starting classroom services"
& docker @Compose up -d --build
if ($LASTEXITCODE -ne 0) { throw "Docker Compose startup failed. Run CarbonTrader-Logs.cmd for details." }
$base = "http://${LanIp}:$Port"
$deadline = (Get-Date).AddMinutes(10)
do {
  if (Test-Url "$base/health" -and Test-Url "$base/ready" -and Test-Url "$base/classroom" -and Test-Url "$base/student") { $healthy=$true; break }
  Start-Sleep -Seconds 4
} while ((Get-Date) -lt $deadline)
if (-not $healthy) { & docker @Compose ps -a; throw "Services did not become healthy in time. Check Docker Desktop resources and CarbonTrader-Logs.cmd." }

Write-Host "PostgreSQL .................. Healthy"
Write-Host "Redis ....................... Healthy"
Write-Host "Migration ................... Complete"
Write-Host "API ......................... Healthy"
Write-Host "Teacher Web ................. Healthy"
Write-Host "Student Web ................. Healthy"
Write-Host "Classroom Gateway ........... Healthy"

$previousPreference=$ErrorActionPreference; $ErrorActionPreference="SilentlyContinue"; & docker @Compose run --rm admin-owner-status *> $null; $ownerStatus=$LASTEXITCODE; $ErrorActionPreference=$previousPreference
if ($ownerStatus -eq 10) {
  Heading "Create the first OWNER"
  $env:ADMIN_OWNER_USERNAME = Read-Host "Username"
  $env:ADMIN_OWNER_DISPLAY_NAME = Read-Host "Display name"
  $secure = Read-Host "Password (8-128 characters)" -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $env:ADMIN_OWNER_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer); $previousPreference=$ErrorActionPreference; $ErrorActionPreference="Continue"; & docker @Compose run --rm admin-create-owner; $createStatus=$LASTEXITCODE; $ErrorActionPreference=$previousPreference; if ($createStatus -ne 0) { throw "First OWNER creation failed." } }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); Remove-Item Env:ADMIN_OWNER_USERNAME,Env:ADMIN_OWNER_DISPLAY_NAME,Env:ADMIN_OWNER_PASSWORD -ErrorAction SilentlyContinue }
} elseif ($ownerStatus -ne 0) { throw "Could not verify first OWNER state." }

Heading "Classroom ready"
Write-Host "Teacher Web:  $base"
Write-Host "Student Web:  $base/student"
Write-Host "Classroom Setup: $base/classroom"
Write-Host "Student API:   $base/v1"
Write-Host "`nIf phones cannot connect, allow inbound TCP $Port for Private networks only. Do not disable Windows Firewall."
Start-Process $base
