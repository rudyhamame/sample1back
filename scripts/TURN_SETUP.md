Shared-secret TURN setup for PhenoMed using eturnal

Files prepared in this repo:
- `.env`
- `scripts/eturnal.yml`
- `scripts/eturnal.example.yml`

Why eturnal:
- eturnal supports the TURN REST shared-secret auth model your backend already uses.
- The backend generates temporary TURN credentials using `Base64(HMAC-SHA1(secret, expiry:userId))`, which is compatible with eturnal's `secret` option.
- eturnal has an official Windows installer, which makes it a better fit for a Windows VPS than coturn.

Backend values already prepared:
```env
WEBRTC_TURN_URLS=turn:46.58.138.141:3478?transport=udp,turn:46.58.138.141:3478?transport=tcp,turns:46.58.138.141:5349?transport=tcp
WEBRTC_TURN_SECRET=8b2ab6fb014f4761b5f3e827fc6c7cd9feb32c08708a484f9191654d3738876f
WEBRTC_TURN_TTL_SECONDS=86400
```

Windows VPS steps:

1. Download and install eturnal on the Windows server
- Official overview: https://eturnal.net/index.html
- Official docs: https://eturnal.net/doc/
- Official Windows downloads: https://eturnal.net/download/windows/

2. Copy the prepared config into the eturnal config location you want to use
```powershell
Copy-Item "E:\mctosh\sample1back\scripts\eturnal.yml" "C:\Program Files\eturnal\etc\eturnal.yml"
```

3. Open Windows Firewall ports in an elevated PowerShell
```powershell
netsh advfirewall firewall add rule name="TURN 3478 UDP" dir=in action=allow protocol=UDP localport=3478
netsh advfirewall firewall add rule name="TURN 3478 TCP" dir=in action=allow protocol=TCP localport=3478
netsh advfirewall firewall add rule name="TURN 5349 TCP" dir=in action=allow protocol=TCP localport=5349
netsh advfirewall firewall add rule name="TURN Relay UDP" dir=in action=allow protocol=UDP localport=49160-49200
```

4. Start eturnal
- The official Windows installer starts eturnal as a Windows service controlled by SCM.
- Restart the service after copying the config.

Restart the service:
```powershell
Restart-Service eturnal
```

If you want to inspect the installed service first:
```powershell
Get-Service eturnal
```

5. Verify the server is listening
```powershell
netstat -ano | findstr :3478
netstat -ano | findstr :5349
```

6. Restart the backend after updating `.env`
```powershell
cd E:\mctosh\sample1back
npm run dev
```

7. Retest the call and inspect browser logs
- Successful relay setup should eventually show `relay` candidates in the WebRTC diagnostics.
- If you still see only `host` and `srflx`, the eturnal service is not relaying yet or the relay UDP range is blocked.

Important notes:
- `realm` should match the host identifier you use in `WEBRTC_TURN_URLS`. With the current repo setup, that is `46.58.138.141`.
- `relay_ipv4_addr` must be the server's public IPv4 address.
- The relay UDP range `49160:49200` must be reachable from the internet.
- If you later add a TURN hostname, update both `realm` and `WEBRTC_TURN_URLS` to use that hostname consistently.
- On Windows, eturnal is configured by default at `C:\Program Files\eturnal\etc\eturnal.yml`.
- On Windows, eturnal logs are written by default under `C:\Program Files\eturnal\log`.

Official references used:
- eturnal overview: https://eturnal.net/index.html
- eturnal documentation: https://eturnal.net/doc/
- eturnal configuration overview: https://eturnal.net/tmp/doc/readme.html
- eturnal for Windows: https://eturnal.net/windows/
