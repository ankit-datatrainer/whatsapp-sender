# WhatsApp Campaign Manager — runs the Express + whatsapp-web.js engine
# on any always-on host (Render, Railway, Fly.io, a VPS, etc.)
FROM node:20-slim

# Install Chromium + the libraries whatsapp-web.js/Puppeteer need to launch it.
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates fonts-liberation \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 libatspi2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Use the system Chromium instead of downloading Puppeteer's own copy.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the app
COPY . .

# The host injects PORT; the server already reads process.env.PORT
EXPOSE 3000

CMD ["node", "server.js"]
