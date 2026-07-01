/**
 * WhatsApp Campaign Manager - Web UI
 * Express + Socket.IO backend wrapping whatsapp-web.js
 */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const xlsx = require('xlsx');
const QRCode = require('qrcode');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const isServerless = !!process.env.VERCEL;
const ROOT = __dirname;
const DATA_ROOT = isServerless ? '/tmp' : __dirname;
const UPLOAD_DIR = path.join(DATA_ROOT, 'uploads');
const TEMPLATES_FILE = path.join(DATA_ROOT, 'templates.json');
const REPORT_FILE = path.join(DATA_ROOT, 'Campaign_Report.json');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(express.json());
app.use(cookieParser());

// Protected routes middleware
app.use((req, res, next) => {
    if (req.path === '/dashboard.html') {
        if (req.cookies && req.cookies.auth === 'true') {
            return next();
        } else {
            return res.redirect('/');
        }
    }
    next();
});

app.use(express.static(path.join(ROOT, 'public')));

// ---------- Auth endpoint ----------
app.post('/api/login', (req, res) => {
    const { id, password } = req.body;
    if (id === 'support@ankitkumaracademy.com' && password === 'Kumar@20.26') {
        res.cookie('auth', 'true', { maxAge: 24 * 60 * 60 * 1000, httpOnly: false }); // httpOnly: false allows client JS to check if logged in (optional)
        return res.json({ success: true });
    }
    res.status(401).json({ success: false, error: 'Invalid ID or Password' });
});

// ---------- File uploads ----------
const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, UPLOAD_DIR),
        filename: (req, file, cb) => cb(null, Date.now() + '__' + file.originalname),
    }),
});

// ---------- Templates persistence ----------
function loadTemplates() {
    try {
        return JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8'));
    } catch {
        return [];
    }
}
function saveTemplates(list) {
    fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(list, null, 2));
}

app.get('/api/templates', (req, res) => res.json(loadTemplates()));

app.post('/api/templates', (req, res) => {
    const { name, body } = req.body;
    if (!name || !body) return res.status(400).json({ error: 'name and body required' });
    const list = loadTemplates();
    const existing = list.find(t => t.id === req.body.id);
    if (existing) {
        existing.name = name;
        existing.body = body;
    } else {
        list.push({ id: Date.now().toString(), name, body });
    }
    saveTemplates(list);
    res.json(list);
});

app.delete('/api/templates/:id', (req, res) => {
    const list = loadTemplates().filter(t => t.id !== req.params.id);
    saveTemplates(list);
    res.json(list);
});

// ---------- Upload data file & parse columns + rows ----------
app.post('/api/upload', upload.single('datafile'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    try {
        const workbook = xlsx.readFile(req.file.path);
        const sheetNames = workbook.SheetNames;
        const firstSheet = workbook.Sheets[sheetNames[0]];
        const rows = xlsx.utils.sheet_to_json(firstSheet, { defval: '' });
        const columns = rows.length ? Object.keys(rows[0]) : [];
        res.json({
            filePath: req.file.path,
            fileName: req.file.originalname,
            sheetNames,
            columns,
            rowCount: rows.length,
            preview: rows.slice(0, 5),
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to parse file: ' + err.message });
    }
});

// Re-read a specific sheet
app.post('/api/sheet', (req, res) => {
    const { filePath, sheetName } = req.body;
    try {
        const workbook = xlsx.readFile(filePath);
        const ws = workbook.Sheets[sheetName] || workbook.Sheets[workbook.SheetNames[0]];
        const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });
        const columns = rows.length ? Object.keys(rows[0]) : [];
        res.json({ columns, rowCount: rows.length, preview: rows.slice(0, 5) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------- WhatsApp client / campaign engine ----------
let waClient = null;
let waReady = false;
let waInitializing = false;
let campaignRunning = false;
let stopRequested = false;

function log(socketMsg, level = 'info') {
    console.log(`[${level}] ${socketMsg}`);
    io.emit('log', { time: new Date().toLocaleTimeString(), message: socketMsg, level });
}

// Locate an installed Chrome/Chromium/Edge to use instead of bundled chromium.
// Works on Windows (local dev) and Linux (Docker / Render / Railway / VPS).
function findChrome() {
    const candidates = [
        process.env.PUPPETEER_EXECUTABLE_PATH,      // set this in Docker / hosting env
        // Linux (Docker, Render, Railway, VPS)
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        // Windows (local dev)
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ];
    return candidates.find(p => p && fs.existsSync(p));
}

function cleanPhone(raw, defaultCountryCode) {
    let p = String(raw).replace(/\D/g, '');
    if (!p) return null;
    if (defaultCountryCode && p.length === 10) p = defaultCountryCode + p;
    return p;
}

function fillTemplate(body, row) {
    return body.replace(/(?:\{\{\s*([^}]+?)\s*\}\})|(?:\[\s*([^\]]+?)\s*\])/g, (_, key1, key2) => {
        const key = key1 || key2;
        const k = Object.keys(row).find(c => c.toLowerCase() === key.toLowerCase());
        return k ? String(row[k]) : '';
    });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Tear down any existing client cleanly, swallowing EBUSY lock errors.
async function destroyExistingClient({ logout = false } = {}) {
    if (!waClient) return;
    const oldClient = waClient;
    waClient = null;
    waReady = false;
    try {
        if (logout) {
            await oldClient.logout().catch(() => {});
        }
        await oldClient.destroy().catch(() => {});
    } catch (err) {
        // EBUSY errors happen on Windows when Chrome still holds DB files — safe to ignore.
        log('Cleanup notice: ' + err.message, 'warn');
    }
}

async function initWhatsApp() {
    if (waInitializing) return;
    waInitializing = true;
    io.emit('status', { waReady, waInitializing, campaignRunning });

    // Always tear down any previous client first so we get a fresh QR.
    if (waClient) {
        log('Disconnecting previous WhatsApp session before reconnecting...', 'warn');
        await destroyExistingClient({ logout: false });
        io.emit('wa-disconnected');
        // Small pause to let Chrome release file handles on Windows.
        await sleep(1500);
    }

    log('Initializing WhatsApp client... (this can take 10-30s)');

    const chromePath = findChrome();
    const puppeteerOpts = {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    };
    if (chromePath) {
        puppeteerOpts.executablePath = chromePath;
        log('Using browser: ' + chromePath);
    } else {
        log('Using Puppeteer bundled Chromium.');
    }

    waClient = new Client({
        authStrategy: new LocalAuth({ dataPath: process.env.WWEBJS_DATA_PATH || undefined }),
        puppeteer: puppeteerOpts,
    });

    // Safety net: if 'ready' never fires after authentication, warn the user.
    let readyTimer = setTimeout(() => {
        if (!waReady) {
            log('Still finalizing after 90s. If this persists, the saved session may be stale — ' +
                'delete the .wwebjs_auth folder and reconnect to scan a fresh QR.', 'warn');
            io.emit('wa-slow');
        }
    }, 90000);

    waClient.on('loading_screen', (percent, message) => {
        log(`Loading WhatsApp... ${percent}%`);
        io.emit('wa-loading', { percent });
    });

    waClient.on('qr', async (qr) => {
        try {
            const dataUrl = await QRCode.toDataURL(qr);
            io.emit('qr', dataUrl);
            log('QR code ready — scan it with WhatsApp > Linked Devices.', 'warn');
        } catch (e) {
            log('Failed to render QR: ' + e.message, 'error');
        }
    });

    waClient.on('authenticated', () => {
        log('Authenticated. Session saved for future reconnects.', 'success');
    });

    waClient.on('ready', () => {
        waReady = true;
        waInitializing = false;
        clearTimeout(readyTimer);
        io.emit('wa-ready');
        io.emit('status', { waReady, waInitializing, campaignRunning });
        log('WhatsApp client is ready and authenticated!', 'success');
    });

    waClient.on('auth_failure', (msg) => {
        log('Authentication failure: ' + msg, 'error');
        io.emit('wa-auth-failure');
        waClient = null;
        waInitializing = false;
        io.emit('status', { waReady, waInitializing, campaignRunning });
    });

    waClient.on('disconnected', (reason) => {
        waReady = false;
        waInitializing = false;
        io.emit('wa-disconnected');
        io.emit('status', { waReady, waInitializing, campaignRunning });
        log('WhatsApp client disconnected: ' + reason, 'error');
        waClient = null;
    });

    waClient.initialize().catch((err) => {
        log('Failed to start WhatsApp client: ' + err.message, 'error');
        io.emit('wa-error', err.message);
        waClient = null;
        waInitializing = false;
        io.emit('status', { waReady, waInitializing, campaignRunning });
    });
}

async function runCampaign(config) {
    const {
        filePath, sheetName, nameColumn, phoneColumn,
        defaultCountryCode, messages, minDelay, maxDelay, limit,
    } = config;

    campaignRunning = true;
    stopRequested = false;

    const workbook = xlsx.readFile(filePath);
    const ws = workbook.Sheets[sheetName] || workbook.Sheets[workbook.SheetNames[0]];
    let rows = xlsx.utils.sheet_to_json(ws, { defval: '' });
    if (limit && limit > 0) rows = rows.slice(0, limit);

    log(`Starting campaign for ${rows.length} contacts with ${messages.length} message step(s).`);

    const results = { success: [], failed: [] };
    io.emit('campaign-start', { total: rows.length });

    for (let i = 0; i < rows.length; i++) {
        if (stopRequested) {
            log('Campaign stopped by user.', 'warn');
            break;
        }
        const row = rows[i];
        const name = String(row[nameColumn] || 'Friend').trim();
        const phoneRaw = row[phoneColumn];
        const phone = cleanPhone(phoneRaw, defaultCountryCode);

        const progress = { index: i + 1, total: rows.length, name, phone };

        if (!phone) {
            results.failed.push({ name, phone: phoneRaw, reason: 'No phone number' });
            io.emit('contact-result', { ...progress, status: 'failed', reason: 'No phone number' });
            continue;
        }

        const chatId = phone + '@c.us';
        try {
            const isRegistered = await waClient.isRegisteredUser(chatId);
            if (!isRegistered) {
                results.failed.push({ name, phone, reason: 'Not registered on WhatsApp' });
                io.emit('contact-result', { ...progress, status: 'failed', reason: 'Not on WhatsApp' });
            } else {
                // Send the sequence of messages with per-message delays
                for (let m = 0; m < messages.length; m++) {
                    if (stopRequested) break;
                    const step = messages[m];
                    if (m > 0 && step.delay > 0) {
                        log(`Waiting ${step.delay}s before message #${m + 1} to ${name}...`);
                        await sleep(step.delay * 1000);
                    }
                    const text = fillTemplate(step.body, row);
                    await waClient.sendMessage(chatId, text);
                    log(`Message #${m + 1} sent to ${name} (${phone})`, 'success');
                }
                results.success.push({ name, phone });
                io.emit('contact-result', { ...progress, status: 'success' });
            }
        } catch (err) {
            results.failed.push({ name, phone, reason: err.message });
            io.emit('contact-result', { ...progress, status: 'failed', reason: err.message });
            log(`Failed for ${name}: ${err.message}`, 'error');
        }

        // Safety delay between contacts
        if (i < rows.length - 1 && !stopRequested) {
            const secs = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
            log(`Waiting ${secs}s before next contact (ban safety)...`);
            await sleep(secs * 1000);
        }
    }

    fs.writeFileSync(REPORT_FILE, JSON.stringify(results, null, 2));
    campaignRunning = false;
    io.emit('campaign-done', {
        success: results.success.length,
        failed: results.failed.length,
        results,
    });
    log(`Campaign finished. ${results.success.length} sent, ${results.failed.length} failed.`,
        results.failed.length ? 'warn' : 'success');
}

// ---------- Socket events ----------
io.on('connection', (socket) => {
    socket.emit('status', { waReady, waInitializing, campaignRunning });

    // Connect always tears down any previous client, then starts fresh.
    socket.on('connect-whatsapp', () => {
        if (!waInitializing) {
            initWhatsApp();
        }
    });

    socket.on('start-campaign', (config) => {
        if (!waReady) return log('WhatsApp is not connected yet.', 'error');
        if (campaignRunning) return log('A campaign is already running.', 'error');
        runCampaign(config).catch(err => {
            campaignRunning = false;
            log('Campaign error: ' + err.message, 'error');
        });
    });

    socket.on('stop-campaign', () => {
        stopRequested = true;
    });

    // Disconnect: keep session by default so next Connect is instant.
    // Pass { logout: true } to clear the saved session (forces fresh QR next time).
    socket.on('disconnect-whatsapp', async ({ logout } = {}) => {
        waAutoConnect = false;
        
        if (campaignRunning) {
            stopRequested = true;
            log('Stopping running campaign before disconnecting...', 'warn');
        }
        
        try {
            if (waClient) {
                // If we are stuck initializing, logout() can hang forever, so we just destroy
                if (logout && waReady) {
                    await waClient.logout().catch(e => log('Logout error (ignoring): ' + e.message));
                }
                await waClient.destroy().catch(e => log('Destroy error (ignoring): ' + e.message));
            }
        } catch (e) {
            log('Error disconnecting WhatsApp: ' + e.message, 'error');
        }
        
        if (logout) {
            // Forcefully delete the session folder to guarantee a clean slate
            const authPath = path.join(__dirname, '.wwebjs_auth');
            if (fs.existsSync(authPath)) {
                fs.rmSync(authPath, { recursive: true, force: true });
                log('Deleted corrupted or old .wwebjs_auth session folder.', 'info');
            }
        }
        
        waClient = null;
        waReady = false;
        waInitializing = false;
        log('WhatsApp disconnected.', 'warn');
        io.emit('wa-disconnected');
    });
});

if (!isServerless || require.main === module) {
    server.listen(PORT, () => {
        console.log(`\nWhatsApp Campaign Manager running at: http://localhost:${PORT}\n`);
    });
}

module.exports = app;
