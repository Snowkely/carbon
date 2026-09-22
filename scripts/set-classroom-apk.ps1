param(
  [Parameter(Mandatory=$true, Position=0)]
  [string]$ApkPath
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Source = (Resolve-Path -LiteralPath $ApkPath).Path
if ([IO.Path]::GetExtension($Source) -ne ".apk") { throw "The selected file must have an .apk extension." }
if ((Get-Item -LiteralPath $Source).Length -eq 0) { throw "The selected APK is empty." }
$TargetDirectory = Join-Path $Root "deploy\local-classroom\downloads"
$Target = Join-Path $TargetDirectory "CarbonTrader.apk"
New-Item -ItemType Directory -Force -Path $TargetDirectory | Out-Null
Copy-Item -LiteralPath $Source -Destination $Target -Force
$Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Target).Hash.ToLowerInvariant()
Write-Host "Classroom APK installed at $Target"
Write-Host "SHA-256: $Hash"
Write-Host "Restart the classroom stack so the download link becomes available."
