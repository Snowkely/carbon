# CarbonTrader production deployment

This runbook deploys CarbonTrader beside other applications without claiming the host root path. The production defaults are:

- repository directory: `/opt/carbon-trader`
- Compose project: `carbon-trader`
- loopback ingress: `127.0.0.1:8089`
- public prefix: `/carbon-trader`
- private PostgreSQL database/volume and private Redis volume owned by this Compose project

The Teacher Web, Student Web, API, PostgreSQL, and Redis have no host port. Only the Docker reverse proxy publishes a port, and it binds to loopback.

## First installation

```bash
sudo mkdir -p /opt/carbon-trader
sudo chown "$USER":"$USER" /opt/carbon-trader
git clone https://github.com/Snowkely/carbon.git /opt/carbon-trader
cd /opt/carbon-trader
cp deploy/.env.example deploy/.env.production
chmod 600 deploy/.env.production
```

Edit `deploy/.env.production`. Generate unique PostgreSQL and JWT secrets; do not copy values from another application. Keep these deployment values:

```dotenv
COMPOSE_PROJECT_NAME=carbon-trader
INGRESS_PORT=8089
PUBLIC_BASE_PATH=/carbon-trader
CORS_ALLOWED_ORIGINS=http://173.234.14.233
```

`CORS_ALLOWED_ORIGINS` is an origin only. It must not include `/carbon-trader`.

Validate and start:

```bash
docker compose --env-file deploy/.env.production -f docker-compose.production.yml config --quiet
docker compose --env-file deploy/.env.production -f docker-compose.production.yml up -d --build
docker compose --env-file deploy/.env.production -f docker-compose.production.yml ps
curl --fail http://127.0.0.1:8089/carbon-trader/health
curl --fail http://127.0.0.1:8089/carbon-trader/ready
```

The one-shot `migrate` service runs `prisma migrate deploy`. The subsequent idempotent `initialize` service creates controlled reference/content data without demo users, then the API starts. Application startup stops if either job fails.

## First Teacher OWNER

The repository already provides a guarded OWNER bootstrap. It refuses to create a second OWNER, hashes the password with Argon2id, and appends a Teacher account audit event. Run it on the server without placing the password on the command line or in the environment file:

```bash
cd /opt/carbon-trader
read -r -p "OWNER username: " ADMIN_OWNER_USERNAME
read -r -p "OWNER display name: " ADMIN_OWNER_DISPLAY_NAME
read -r -s -p "OWNER password: " ADMIN_OWNER_PASSWORD; echo
export ADMIN_OWNER_USERNAME ADMIN_OWNER_DISPLAY_NAME ADMIN_OWNER_PASSWORD
docker compose --env-file deploy/.env.production -f docker-compose.production.yml --profile admin run --rm admin-create-owner
unset ADMIN_OWNER_USERNAME ADMIN_OWNER_DISPLAY_NAME ADMIN_OWNER_PASSWORD
```

When more than one active School exists, also export `ADMIN_OWNER_SCHOOL_ID` before running the command and unset it afterward.

## Host Nginx

Add this block to the existing HTTP server for `173.234.14.233`. The `proxy_pass` deliberately has no trailing slash so the public prefix reaches CarbonTrader's Docker proxy.

```nginx
location = /carbon-trader {
    return 301 /carbon-trader/;
}

location /carbon-trader/ {
    proxy_pass http://127.0.0.1:8089;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Then validate and reload the host Nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Public checks:

```bash
curl --fail http://173.234.14.233/carbon-trader/health
curl --fail http://173.234.14.233/carbon-trader/ready
curl --head http://173.234.14.233/carbon-trader/
curl --head http://173.234.14.233/carbon-trader/student
```

## Normal updates

Create a database backup first, then update without deleting volumes:

```bash
cd /opt/carbon-trader
git pull --ff-only
docker compose --env-file deploy/.env.production -f docker-compose.production.yml up -d --build
docker compose --env-file deploy/.env.production -f docker-compose.production.yml ps
```

Never run `docker compose down -v` during an ordinary upgrade. The `-v` option deletes CarbonTrader's PostgreSQL and Redis volumes. A normal `up -d --build`, `restart`, `stop`, or `start` preserves data.

## Backup and recovery caution

Use `pg_dump` or infrastructure-native backups, encrypt backups, keep copies outside the application host, and rehearse restores into a separate Compose project. Never restore into Sustainability Frontiers or attach CarbonTrader to its networks, volumes, database, Redis, project name, or secrets.

For rollback, restore prior immutable application images only after checking database migration compatibility. Do not reverse or delete migrations blindly.

## HTTPS migration

When a domain and TLS certificate are available, change `CORS_ALLOWED_ORIGINS` to the HTTPS origin and update the host Nginx server. The browser applications continue deriving `/carbon-trader/v1` from the same origin; no IP is embedded in Student Web.
