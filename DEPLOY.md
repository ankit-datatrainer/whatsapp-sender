# Deploying the WhatsApp Campaign Manager

This app uses `whatsapp-web.js`, which drives a real Chromium browser and keeps a
live WhatsApp Web session in memory. It therefore needs an **always-on host** —
it **cannot run on Vercel / Netlify / serverless** (those tear the process down
after each request, so the QR session dies and never appears).

The whole app (frontend + engine) runs as a single service. Pick one host below.

---

## Option A — Render (recommended, one click)

1. Push this folder to a GitHub repo.
2. Go to https://render.com → **New → Blueprint** → select your repo.
3. Render reads `render.yaml`, builds the `Dockerfile`, and creates the service
   with a persistent disk (so your login survives restarts).
4. Open the service URL → **Connect WhatsApp** → scan the QR. Done.

> Use the **Starter** plan (or higher). The **Free** plan sleeps after 15 min of
> inactivity, which drops the WhatsApp session.

---

## Option B — Railway

1. Push to GitHub.
2. https://railway.app → **New Project → Deploy from GitHub repo**.
3. Railway auto-detects the `Dockerfile` and builds it.
4. (Recommended) Add a **Volume** mounted at `/data`, then set the variable
   `WWEBJS_DATA_PATH=/data/wwebjs` so the session persists.
5. Open the generated domain → **Connect WhatsApp** → scan the QR.

---

## Option C — Any VPS (Hostinger VPS, DigitalOcean, etc.)

Requires Docker on an Ubuntu VPS (a **VPS**, not shared/`public_html` hosting):

```bash
git clone <your-repo> && cd Mine_Data
docker build -t wa-campaign .
docker run -d --name wa-campaign -p 80:3000 \
  -v wa_session:/data \
  -e WWEBJS_DATA_PATH=/data/wwebjs \
  wa-campaign
```

Then open `http://<your-server-ip>` and scan the QR.

---

## Keeping the Vercel frontend (optional)

If you want to keep using your Vercel URL for the UI, you can — but the Socket.IO
connection must point at the always-on backend instead of same-origin. Simplest is
to just use the backend host's URL directly (it already serves the same UI).

---

## Run locally (no hosting)

```bash
npm install
npm start
# open http://localhost:3000
```
