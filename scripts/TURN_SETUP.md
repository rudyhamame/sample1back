Shared-secret TURN setup for PhenoMed using coturn

Files prepared in this repo:
- `.env`
- `scripts/turnserver.conf`
- `scripts/turnserver.shared-secret.conf.example`

Why coturn:
- coturn is the more common TURN deployment for WebRTC.
- Your backend already generates temporary TURN REST credentials in the standard shared-secret format.
- The current backend values are compatible with coturn's `use-auth-secret` mode.

Backend values already prepared:
```env
WEBRTC_TURN_URLS=turn:46.58.138.141:3478?transport=udp,turn:46.58.138.141:3478?transport=tcp,turns:46.58.138.141:5349?transport=tcp
WEBRTC_TURN_SECRET=8b2ab6fb014f4761b5f3e827fc6c7cd9feb32c08708a484f9191654d3738876f
WEBRTC_TURN_TTL_SECONDS=86400
```

Recommended deployment:
- Run coturn on a Linux VPS.
- Windows coturn setups are possible but are much less common and harder to support reliably.

Linux VPS steps:

1. Install coturn
```bash
sudo apt update
sudo apt install coturn -y
```

2. Enable the service
```bash
sudo sed -i 's/^TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
```

3. Copy the prepared config into place
```bash
sudo cp /path/to/turnserver.conf /etc/turnserver.conf
```

4. Open firewall ports
```bash
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 5349/tcp
sudo ufw allow 49160:49200/udp
```

5. Restart and verify coturn
```bash
sudo systemctl restart coturn
sudo systemctl enable coturn
sudo systemctl status coturn
sudo ss -luntp | grep turn
```

6. Check recent coturn logs
```bash
sudo journalctl -u coturn -n 100 --no-pager
```

7. Restart the backend after updating `.env`
```bash
cd /path/to/sample1back
npm run dev
```

8. Retest the call and inspect browser logs
- Successful TURN setup should eventually show `relay` candidates in the WebRTC diagnostics.
- If you still see only `host` and `srflx`, the usual causes are TURN auth mismatch, blocked relay UDP ports, or clients using a VPN.

Windows note:
- If your app server is Windows, you can still use coturn by hosting TURN separately on a small Linux VPS.
- That is the recommended path instead of trying to force coturn onto Windows.

Important notes:
- `realm` should match the host identifier you use in `WEBRTC_TURN_URLS`. With the current repo setup, that is `46.58.138.141`.
- `external-ip` must be the TURN server's public IPv4 address.
- The relay UDP range `49160:49200` must be reachable from the internet.
- If you later add a TURN hostname, update both `realm` and `WEBRTC_TURN_URLS` to use that hostname consistently.
