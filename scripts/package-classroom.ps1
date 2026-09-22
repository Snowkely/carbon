param(
  [Alias("include-apk")]
  [string]$IncludeApk
)

$ErrorActionPreference="Stop"
$Root=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Version=(Get-Content -Raw (Join-Path $Root "package.json")|ConvertFrom-Json).version
$Suffix=if($IncludeApk){"-android"}else{""}
$Dist=Join-Path $Root "dist-classroom"; $Stage=Join-Path $Dist "CarbonTrader-LocalClassroom-$Version$Suffix"; $Zip="$Stage.zip"
if(-not $Stage.StartsWith($Dist,[StringComparison]::OrdinalIgnoreCase)){throw "Unsafe staging path"}
New-Item -ItemType Directory -Force $Dist|Out-Null
if(Test-Path $Stage){Remove-Item -LiteralPath $Stage -Recurse -Force}; if(Test-Path $Zip){Remove-Item -LiteralPath $Zip -Force}; New-Item -ItemType Directory $Stage|Out-Null
$rootFiles=@(".dockerignore","package.json","pnpm-lock.yaml","pnpm-workspace.yaml","tsconfig.base.json","turbo.json","README.md","docker-compose.classroom.yml","CarbonTrader-Start.cmd","CarbonTrader-Stop.cmd","CarbonTrader-Status.cmd","CarbonTrader-Logs.cmd","CarbonTrader-Backup.cmd","CarbonTrader-Restore.cmd","CarbonTrader-Start.command","CarbonTrader-Stop.command","CarbonTrader-Status.command","CarbonTrader-Logs.command","CarbonTrader-Backup.command","CarbonTrader-Restore.command")
foreach($file in $rootFiles){Copy-Item -LiteralPath (Join-Path $Root $file) -Destination $Stage}
foreach($directory in @("apps","packages","deploy","docs")){Copy-Item -LiteralPath (Join-Path $Root $directory) -Destination $Stage -Recurse}
$excludedDirectories=@("node_modules",".git",".next",".expo",".eas-bundle-test",".turbo","coverage","dist","dist-classroom","backups","exports","tmp","temp")
Get-ChildItem -LiteralPath $Stage -Directory -Recurse -Force | Sort-Object FullName -Descending | Where-Object {$excludedDirectories -contains $_.Name}|Remove-Item -Recurse -Force
Get-ChildItem -LiteralPath $Stage -File -Recurse -Force | Where-Object {
  ((($_.Name -like ".env*") -and $_.Name -ne ".env.example" -and $_.Name -ne ".env.classroom.example") -or
  $_.Extension -in @(".dump",".pem",".key",".p12",".pfx",".jks",".keystore",".ipa",".apk",".aab",".log") -or $_.Name -eq "Thumbs.db" -or $_.Name -eq ".DS_Store")
}|Remove-Item -Force
if($IncludeApk){
  $Apk=(Resolve-Path -LiteralPath $IncludeApk).Path
  if([IO.Path]::GetExtension($Apk) -ne ".apk"){throw "-IncludeApk must reference an .apk file"}
  if((Get-Item -LiteralPath $Apk).Length -eq 0){throw "The supplied APK is empty"}
  $ApkTarget=Join-Path $Stage "deploy\local-classroom\downloads\CarbonTrader.apk"
  Copy-Item -LiteralPath $Apk -Destination $ApkTarget -Force
}
$badNames=Get-ChildItem -LiteralPath $Stage -File -Recurse -Force | Where-Object {$_.Name -in @(".env",".env.local",".env.classroom") -or $_.Extension -in @(".dump",".pem",".key",".p12",".pfx",".jks",".keystore")}
if($badNames){throw "Sensitive file rejected: $($badNames.FullName -join ', ')"}
$secretPattern='-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|JWT_(ACCESS|REFRESH)_SECRET=[A-Za-z0-9+/]{32,}|POSTGRES_PASSWORD=[A-Fa-f0-9]{32,}'
$leaks=Get-ChildItem -LiteralPath $Stage -File -Recurse | Where-Object {$_.Length -lt 5MB} | Select-String -Pattern $secretPattern
if($leaks){throw "Potential populated secret rejected: $($leaks.Path|Select-Object -Unique)"}
Compress-Archive -LiteralPath $Stage -DestinationPath $Zip -CompressionLevel Optimal
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive=[IO.Compression.ZipFile]::OpenRead($Zip); try {$bad=$archive.Entries|Where-Object {$_.FullName -match '(^|[\\/])(\.env|\.env\.local|\.env\.classroom|node_modules|\.git|backups)([\\/]|$)|\.(dump|pem|key|p12|pfx|jks|keystore)$'}; if($bad){throw "ZIP verification rejected $($bad.FullName -join ', ')"}; $apkEntries=@($archive.Entries|Where-Object {$_.FullName -match '\.apk$'}); if($IncludeApk -and $apkEntries.Count -ne 1){throw "Android package must contain exactly one APK"}; if(-not $IncludeApk -and $apkEntries.Count -ne 0){throw "Base package unexpectedly contains an APK"}} finally {$archive.Dispose()}
$hash=(Get-FileHash -Algorithm SHA256 $Zip).Hash.ToLowerInvariant(); Write-Host "Created $Zip`nSHA-256: $hash`nSecret/package scan: PASS"
