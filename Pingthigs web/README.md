# PingThings Web for Render

Render-ready PingThings project with:

- Node.js + Express backend
- SQLite database with persistent Render disk support
- Built-in monitoring engine
- Web dashboard for add/edit/delete/check/history
- Single service deploy on Render

## Important Cloud Limitation

This app runs well on Render for **publicly reachable hosts/services**.

Examples that work on Render:

- `example.com`
- `api.openai.com`
- Public server IPs
- TCP ports on internet-facing hosts

Examples that do **not** work from Render:

- `192.168.x.x`
- `10.x.x.x`
- Devices that only exist on your home or office LAN

If you want to monitor private LAN devices, you need a local agent/server inside that network.

## Supported Check Types

- `http`
- `https`
- `tcp`
- `dns`

## Local Run

```bash
cp .env.example .env
npm install
npm start
```

App runs on `http://localhost:4000`.

## Render Deploy

1. Push this folder to GitHub.
2. Create a new Render Web Service from the repo.
3. Render will detect `render.yaml`.
4. Deploy.

If you create the service manually in the Render dashboard, make sure:

- Build Command = `npm install`
- Start Command = `npm start`

If Render is trying to run only `start`, your service settings are incorrect and deploy will fail.

The database is stored on the mounted disk at `/var/data/monitor.db`.

## API

### Health

`GET /health`

### List devices

`GET /api/devices`

### Create device

`POST /api/devices`

Example body:

```json
{
  "name": "OpenAI API",
  "target": "api.openai.com",
  "deviceType": "server",
  "protocol": "https",
  "port": 443,
  "path": "/v1/models",
  "checkIntervalSec": 60,
  "isActive": true
}
```

### Update device

`PATCH /api/devices/:id`

### Delete device

`DELETE /api/devices/:id`

### Device history

`GET /api/devices/:id/history?limit=50`

### Run manual check

`POST /api/devices/:id/check`
