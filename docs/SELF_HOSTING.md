# Self-Hosting Guide

## Docker (recommended)

```bash
cp .env.example .env
openssl rand -hex 32   # → SESSION_SECRET
./start.sh             # docker compose up -d --build
./stop.sh              # stops app (keeps db volume)
```

`docker-compose.yml` provides `db` (postgres:16, named volume `pgdata`) and `app` (built image, healthcheck, restart policy).

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
./backup.sh   # → backups/tabletennis-<ts>.sql.gz (uses pg_dump or docker exec)
./restore.sh backups/tabletennis-<ts>.sql.gz   # asks for confirmation, replaces DB
```

Schedule `backup.sh` via cron for production.

## Updates

```bash
git pull
./build.sh        # or: docker compose up -d --build
./start.sh        # migrations apply automatically at boot
```

## Multi-instance

Not supported out of the box (in-memory match/matchmaking state). `REDIS_URL` is reserved for future coordination. Run a single app instance per deployment.
