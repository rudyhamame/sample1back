param(
  [string]$InstallRoot = "",
  [string]$SourceConfig = "E:\mctosh\sample1back\scripts\eturnal.yml"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $SourceConfig)) {
  throw "Source config not found: $SourceConfig"
}

$candidateRoots = @()

if ($InstallRoot) {
  $candidateRoots += $InstallRoot
}

$candidateRoots += @(
  "C:\Program Files\eturnal",
  "C:\eturnal",
  "C:\Program Files (x86)\eturnal"
)

$candidateRoots = $candidateRoots | Select-Object -Unique

$resolvedInstallRoot = $null

foreach ($candidateRoot in $candidateRoots) {
  $binPath = Join-Path $candidateRoot "bin\eturnalctl.exe"
  $serviceExePath = Join-Path $candidateRoot "bin\eturnal.exe"

  if ((Test-Path $binPath) -or (Test-Path $serviceExePath)) {
    $resolvedInstallRoot = $candidateRoot
    break
  }
}

if (-not $resolvedInstallRoot) {
  $service = Get-Service eturnal -ErrorAction SilentlyContinue

  if ($service) {
    throw "The 'eturnal' service exists, but the install folder could not be auto-detected. Re-run the script with -InstallRoot '<eturnal install folder>'."
  }

  throw "Eturnal does not appear to be installed yet. Install eturnal on the Windows VPS first, then rerun this script. If it is already installed in a custom path, rerun with -InstallRoot '<eturnal install folder>'."
}

$targetConfigDir = Join-Path $resolvedInstallRoot "etc"
$targetConfig = Join-Path $targetConfigDir "eturnal.yml"

if (-not (Test-Path $targetConfigDir)) {
  New-Item -ItemType Directory -Path $targetConfigDir -Force | Out-Null
}

Copy-Item $SourceConfig $targetConfig -Force

netsh advfirewall firewall add rule name="TURN 3478 UDP" dir=in action=allow protocol=UDP localport=3478 | Out-Null
netsh advfirewall firewall add rule name="TURN 3478 TCP" dir=in action=allow protocol=TCP localport=3478 | Out-Null
netsh advfirewall firewall add rule name="TURN 5349 TCP" dir=in action=allow protocol=TCP localport=5349 | Out-Null
netsh advfirewall firewall add rule name="TURN Relay UDP" dir=in action=allow protocol=UDP localport=49160-49200 | Out-Null

$service = Get-Service eturnal -ErrorAction SilentlyContinue

if ($service) {
  Restart-Service eturnal
} else {
  Write-Warning "The 'eturnal' Windows service was not found. The config was copied, but you still need to install or register the eturnal service."
}

Write-Host "Resolved eturnal install root: $resolvedInstallRoot"
Write-Host "Eturnal config copied to $targetConfig"
Write-Host "Firewall rules ensured for TURN/TLS/relay ports."
if ($service) {
  Write-Host "Eturnal service restarted."
}
Write-Host "Verify listening ports with: netstat -ano | findstr :3478"
Write-Host "Verify listening ports with: netstat -ano | findstr :5349"
