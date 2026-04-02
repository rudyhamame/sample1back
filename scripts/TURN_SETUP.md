Shared-secret TURN setup for PhenoMed

Files already prepared in this repo:
- `.env`
- `scripts/turnserver.shared-secret.conf.example`

What to replace before using:
- `your-domain.com`
- `YOUR_SERVER_PUBLIC_IP`

Backend values already prepared:
```env
WEBRTC_TURN_URLS=turn:your-domain.com:3478,turns:your-domain.com:5349
WEBRTC_TURN_SECRET=8b2ab6fb014f4761b5f3e827fc6c7cd9feb32c08708a484f9191654d3738876f
WEBRTC_TURN_TTL_SECONDS=86400
```

Ubuntu VPS steps:

1. Install coturn
```bash
sudo apt update
sudo apt install coturn -y
```

2. Enable the service
```bash
sudo sed -i 's/^TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
```

3. Copy the template into place
```bash
sudo cp /path/to/turnserver.shared-secret.conf.example /etc/turnserver.conf
```

4. Open ports
```bash
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 5349/tcp
sudo ufw allow 49160:49200/udp
```

5. Restart and enable
```bash
sudo systemctl restart coturn
sudo systemctl enable coturn
sudo systemctl status coturn
```

6. Restart the backend after updating `.env`
```bash
npm run dev
```

Notes:
- The TURN server must be publicly reachable.
- `realm` should match the hostname you use for TURN.
- If you do not have TLS certificates yet, `turn:` on port `3478` is enough to start testing.
