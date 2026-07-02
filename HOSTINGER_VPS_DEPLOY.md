# Deploy the WhatsApp Campaign Manager on a Hostinger VPS

This runs the **whole app** (frontend + backend + WhatsApp engine) on your VPS as
one always-on service behind Nginx with HTTPS. QR scanning works because the Node
process stays alive.

> Recommended: serve everything from the VPS and use the VPS domain. This avoids
> the cross-domain cookie/CORS problems you'd hit if the frontend stayed on Vercel.
> (Keeping Vercel is covered in the optional **Appendix B**.)

Whenever you see `yourdomain.com`, replace it with your real domain/subdomain, and
`SERVER_IP` with your VPS IP.

---

## 0. What you need before starting

- A Hostinger **VPS** plan (KVM / Ubuntu) — **not** shared/`public_html` hosting.
- A domain or subdomain you can edit DNS for (e.g. `app.yourdomain.com`).
- Your project pushed to a **GitHub repo** (private is fine).
- The VPS root password or SSH key (Hostinger → VPS → Overview).

---

## 1. Point a hostname at the VPS

You **need a hostname** (not a bare IP): HTTPS certificates can't be issued for raw
IPs, and an HTTPS page can't talk to an `http://IP` backend (mixed-content block).

### Don't own a domain? Use a FREE subdomain (recommended, no purchase)

**DuckDNS** (free, permanent):
1. Go to https://www.duckdns.org and sign in (Google/GitHub).
2. Create a name, e.g. `ankit-wa` → you get **`ankit-wa.duckdns.org`**.
3. Put your **VPS IP** in the "current ip" box → **update ip**.

Now use `ankit-wa.duckdns.org` everywhere this guide says `app.yourdomain.com`,
and you can **skip the table below**.

> No-signup alternative: **sslip.io** — the hostname `SERVER_IP.sslip.io`
> (e.g. `31.220.1.2.sslip.io`) auto-resolves to that IP. Works with Certbot too.

### Already own a domain?

In your DNS provider (Hostinger → Domains → DNS):

| Type | Name | Value       | TTL  |
|------|------|-------------|------|
| A    | app  | `SERVER_IP` | 3600 |

This makes `app.yourdomain.com → SERVER_IP`. DNS can take 5–60 min to propagate.
Check with: `nslookup app.yourdomain.com`.

---

## 2. Connect to the VPS over SSH

From your Windows PC (PowerShell or Git Bash):

```bash
ssh root@SERVER_IP
```

Enter the password (or use your key). You're now on the server.

---

## 3. Install Docker (recommended path)

We already ship a `Dockerfile` that bundles Chromium + every library WhatsApp-web
needs, so Docker is the least error-prone option.

```bash
apt update && apt upgrade -y
apt install -y git curl
curl -fsSL https://get.docker.com | sh
docker --version   # confirm it installed
```

> Prefer no Docker? See **Appendix A** for the Node + PM2 route.

---

## 4. Get the code onto the VPS

```bash
cd /opt
git clone https://github.com/ankit-datatrainer/YOUR_REPO.git wa-campaign
cd wa-campaign
```

If the repo is private, either use a GitHub Personal Access Token in the URL
(`https://<TOKEN>@github.com/...`) or set up an SSH deploy key.

---

## 5. Build and run the container

```bash
# Build the image (installs Chromium + deps; takes a few minutes the first time)
docker build -t wa-campaign .

# Run it: keep it restarting, store the WhatsApp login on a named volume so it
# survives restarts/redeploys, and expose it on localhost:3000 (Nginx will proxy).
docker run -d --name wa-campaign \
  --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -v wa_session:/data \
  -e WWEBJS_DATA_PATH=/data/wwebjs \
  -e PORT=3000 \
  wa-campaign
```

Check it's alive and watch the logs:

```bash
docker ps
docker logs -f wa-campaign   # you should see "WhatsApp Campaign Manager running..."  (Ctrl+C to stop tailing)
```

At this point the app is running, but only reachable on the server's localhost.
Nginx (next step) exposes it to the world with HTTPS.

---

## 6. Install and configure Nginx (reverse proxy)

```bash
apt install -y nginx
```

Create the site config:

```bash
nano /etc/nginx/sites-available/wa-campaign
```

Paste this **exactly** — the `Upgrade`/`Connection` headers are what make
Socket.IO (live QR + logs) work. Missing them = QR never appears.

```nginx
server {
    listen 80;
    server_name app.yourdomain.com;

    # Allow large-ish spreadsheet uploads
    client_max_body_size 25M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # WebSocket support (required for Socket.IO)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WhatsApp campaigns are long-lived; don't cut idle connections
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

Enable it and reload:

```bash
ln -s /etc/nginx/sites-available/wa-campaign /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default   # remove the placeholder site
nginx -t                                 # test config — must say "syntax is ok"
systemctl reload nginx
```

Now `http://app.yourdomain.com` should load the landing page.

---

## 7. Add HTTPS (free SSL via Let's Encrypt)

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d app.yourdomain.com
```

Answer the prompts (enter your email, agree, choose redirect HTTP→HTTPS).
Certbot edits the Nginx config and auto-renews. Done — visit
**https://app.yourdomain.com**.

---

## 8. Firewall

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
ufw status
```

Also make sure Hostinger's own firewall (hPanel → VPS → Firewall) allows ports
**22, 80, 443**. Do **not** expose port 3000 publicly — Nginx already fronts it.

---

## 9. First run: connect WhatsApp

1. Open `https://app.yourdomain.com`.
2. Log in (your staff credentials), go to the dashboard.
3. Click **Connect WhatsApp** → scan the QR with WhatsApp → Linked Devices.
4. The session is saved on the `wa_session` volume, so it survives restarts.

---

## 10. Updating the app later (redeploy)

```bash
cd /opt/wa-campaign
git pull
docker build -t wa-campaign .
docker rm -f wa-campaign
docker run -d --name wa-campaign \
  --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -v wa_session:/data \
  -e WWEBJS_DATA_PATH=/data/wwebjs \
  -e PORT=3000 \
  wa-campaign
```

The `wa_session` volume is reused, so you won't need to rescan the QR.

---

## Troubleshooting

- **QR never shows / live log frozen** → Nginx is missing the `Upgrade`/`Connection`
  headers (Step 6), or Hostinger firewall blocks 443. Re-check both.
- **"Failed to launch the browser process"** → using Docker avoids this. If on the
  PM2 route, install Chromium: `apt install -y chromium-browser` and set
  `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser`.
- **Session lost after redeploy** → you didn't mount the `-v wa_session:/data`
  volume or didn't set `WWEBJS_DATA_PATH`.
- **See logs** → `docker logs -f wa-campaign`.
- **Restart** → `docker restart wa-campaign`.

---

## Appendix A — Node + PM2 instead of Docker

```bash
# Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs chromium-browser
# Chromium deps (usually pulled in, but just in case):
apt install -y libnss3 libatk-bridge2.0-0 libgbm1 libasound2 libxshmfence1

cd /opt/wa-campaign
npm install --omit=dev

# Tell the app which browser to use + where to store the session
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
export WWEBJS_DATA_PATH=/opt/wa-campaign/.wwebjs_auth

# Keep it alive with PM2
npm install -g pm2
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
WWEBJS_DATA_PATH=/opt/wa-campaign/.wwebjs_auth \
pm2 start server.js --name wa-campaign
pm2 save
pm2 startup    # run the command it prints, so it survives reboots
```

Then do Steps 6–9 (Nginx + SSL + firewall) exactly the same.

---

## Appendix B — (Optional) Keep the frontend on Vercel

Not recommended because of cross-domain cookies, but if you insist:

1. **Backend (VPS):** enable CORS for your Vercel origin and Socket.IO CORS, e.g.
   `origin: 'https://your-vercel-app.vercel.app', credentials: true`.
2. **Login cookie:** must be set with `SameSite=None; Secure` so the browser sends
   it cross-site. Even then, the cookie belongs to the **VPS** domain, so the
   Vercel-served `dashboard.html` cannot read it — you'd need to move auth to a
   token in `localStorage` and protect the dashboard client-side instead.
3. **Frontend:** point Socket.IO and all `fetch('/api/...')` calls at
   `https://app.yourdomain.com` instead of same-origin.

Because of #2, the simplest correct setup remains: **serve everything from the VPS**
(this guide) and drop the separate Vercel frontend.
```
