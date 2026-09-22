param([ValidateSet("stop","status","logs")][string]$Action="status")
$ErrorActionPreference="Stop"
$Root=(Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$EnvFile=Join-Path $Root "deploy\.env.classroom"
if (-not (Test-Path $EnvFile)) { throw "Classroom runtime is not configured. Run CarbonTrader-Start.cmd first." }
$Args=@("compose","--env-file",$EnvFile,"-f",(Join-Path $Root "docker-compose.classroom.yml"))
Set-Location $Root
if ($Action -eq "stop") { & docker @Args stop; Write-Host "Classroom stopped. Database and Redis volumes were preserved."; exit $LASTEXITCODE }
if ($Action -eq "logs") { & docker @Args logs --follow --tail 200; exit $LASTEXITCODE }
& docker @Args ps -a
$values=@{}; Get-Content $EnvFile | ForEach-Object { if ($_ -match '^([^#=]+)=(.*)$') { $values[$matches[1]]=$matches[2] } }
$base="http://$($values.CLASSROOM_LAN_IP):$($values.CLASSROOM_PORT)"
foreach($path in @("/health","/ready","/classroom","/student")){try{$r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 "$base$path";Write-Host "$path ........ HTTP $($r.StatusCode)"}catch{Write-Host "$path ........ Unavailable" -ForegroundColor Yellow}}
