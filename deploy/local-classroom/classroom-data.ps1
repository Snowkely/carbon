param([ValidateSet("backup","restore")][string]$Action)
$ErrorActionPreference="Stop"
$Root=(Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path; $EnvFile=Join-Path $Root "deploy\.env.classroom"
if(-not(Test-Path $EnvFile)){throw "Run CarbonTrader-Start.cmd first."}
$Compose=@("compose","--env-file",$EnvFile,"-f",(Join-Path $Root "docker-compose.classroom.yml")); Set-Location $Root
if($Action -eq "backup"){
  $folder=Read-Host "Backup folder (blank for .\backups)"; if(-not $folder){$folder=Join-Path $Root "backups"}; $folder=[IO.Path]::GetFullPath($folder); New-Item -ItemType Directory -Force $folder|Out-Null
  $name="CarbonTrader-Classroom-$(Get-Date -Format yyyyMMdd-HHmmss).dump"; $target=Join-Path $folder $name
  if(Test-Path $target){throw "Refusing to overwrite $target"}
  & docker @Compose exec -T postgres sh -c 'pg_dump --format=custom --no-owner --no-privileges --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --file=/tmp/classroom.dump'
  if($LASTEXITCODE -ne 0){throw "pg_dump failed"}; & docker @Compose cp "postgres:/tmp/classroom.dump" $target; & docker @Compose exec -T postgres rm -f /tmp/classroom.dump
  $hash=(Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash.ToLowerInvariant(); Write-Host "Sensitive backup created:`n$target`nSHA-256: $hash"; exit
}
$source=Read-Host "Full path to .dump backup"; $source=(Resolve-Path -LiteralPath $source).Path
if([IO.Path]::GetExtension($source) -ne ".dump"){throw "Restore requires a .dump created by Classroom Backup."}
Write-Host "WARNING: this replaces ONLY the dedicated classroom database. Current classroom data will be lost." -ForegroundColor Yellow
if((Read-Host "Type RESTORE CLASSROOM to continue") -cne "RESTORE CLASSROOM"){throw "Restore cancelled"}
& docker @Compose stop reverse-proxy teacher-web api; & docker @Compose cp $source "postgres:/tmp/classroom-restore.dump"
& docker @Compose exec -T postgres sh -c 'psql --username="$POSTGRES_USER" --dbname=postgres --set=ON_ERROR_STOP=1 --command="SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ''$POSTGRES_DB'' AND pid <> pg_backend_pid();" --command="DROP DATABASE IF EXISTS \"$POSTGRES_DB\";" --command="CREATE DATABASE \"$POSTGRES_DB\" OWNER \"$POSTGRES_USER\";"'
if($LASTEXITCODE -ne 0){throw "Could not recreate the classroom database"}
& docker @Compose exec -T postgres sh -c 'pg_restore --exit-on-error --no-owner --no-privileges --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" /tmp/classroom-restore.dump'; if($LASTEXITCODE -ne 0){throw "pg_restore failed"}
& docker @Compose exec -T postgres rm -f /tmp/classroom-restore.dump
& docker @Compose run --rm migrate; if($LASTEXITCODE -ne 0){throw "Migration verification failed"}; & docker @Compose up -d
Write-Host "Restore complete. Run CarbonTrader-Status.cmd to verify readiness."
