# Self-Hosting Guide

## Zero-dependency (recommended)

```bash
cp .env.example .env
openssl rand -hex 32   # → SESSION_SECRET
npm install && npm run build
./start.sh
```

No Docker needed: an embedded PostgreSQL runs inside the app with data in `./data/pg`.
For persistence across reboots use any process manager (systemd, pm2, etc.) — see below.

## Docker (optional)

```bash
TTS_USE_DOCKER=1 ./start.sh    # docker compose up -d --build
./stop.sh
```

`docker-compose.yml` provides `db` (postgres:16, named volume `pgdata`) and `app`.

## Reverse proxy + HTTPS (nginx example)

```nginx
server {
  listen 443 ssl;
  server_name tt.example.com;
  # ssl_certificate ...;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;   # WebSocket
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Then set `COOKIE_SECURE=true`, `APP_URL=https://tt.example.com`, and add the origin to `ALLOWED_ORIGINS`.

## VPS / home server

Same as Docker. For native installs see INSTALLATION.md. Ensure only ports 80/443 are exposed publicly; Postgres stays internal.

## Backups

```bash
./backup.sh   # → backups/tabletennis-<ts>.json.gz (built-in, no deps; pg_dump used if available)
./restore.sh backups/tabletennis-<ts>.json.gz --yes
```

Schedule `backup.sh` via cron for production.

## Updates

```bash
git pull
./build.sh        # or: docker compose up -d --build
./start.sh        # migrations apply automatically at boot
```

## systemd unit (optional)

```ini
[Unit]
Description=Table Tennis Simulator
After=network.target

[Service]
WorkingDirectory=/opt/table-tennis-simulator
ExecStart=/usr/bin/node server/dist/index.js
Restart=always
EnvironmentFile=/opt/table-tennis-simulator/.env

[Install]
WantedBy=multi-user.target
```

## Multi-instance

Not supported out of the box (in-memory match/matchmaking state). Run a single app instance per deployment.
