$ErrorActionPreference = "Stop"

Write-Host "Service status:"
Get-Service eturnal -ErrorAction SilentlyContinue | Format-Table -AutoSize

Write-Host ""
Write-Host "TURN listening ports:"
netstat -ano | findstr :3478
netstat -ano | findstr :5349

Write-Host ""
Write-Host "Windows Firewall rules:"
netsh advfirewall firewall show rule name="TURN 3478 UDP"
netsh advfirewall firewall show rule name="TURN 3478 TCP"
netsh advfirewall firewall show rule name="TURN 5349 TCP"
netsh advfirewall firewall show rule name="TURN Relay UDP"
