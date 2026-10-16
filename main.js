const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

const BRIDGE_PORT = 8899;

// The window is deliberately larger than the card it holds: a transparent
// margin for the drop shadow to fall into. Without it the shadow is clipped at
// the window edge and reads as a hard smear.
const COMPACT_H = 190;   // just the clock card
const EXPANDED_H = 600;  // clock card + client list / search
const WIDTH = 400;       // 368px card + 16px each side
const MARGIN = 4;

// Collapsed state: a small tab hugging the right edge of the screen.
const PEEK_W = 84;       // 52px tab + room for its shadow to the left
const PEEK_H = 80;
const PEEK_MARGIN = 0;   // flush with the edge, like the other docked widgets

// Backstop only. Chrome now tells us the moment a conversation loses focus,
// so this just covers the case where Chrome dies without saying goodbye.
const IDLE_MS = 60 * 1000;

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

const DEFAULTS = {
  overrides: {},   // person key -> zone they were corrected to
  auto: true,
  clients: [
    { name: 'Hershel', zone: 'America/New_York', city: 'New York', region: 'Eastern', country: 'United States', flag: '🇺🇸' }
  ],
  activeId: 0,
  pos: null
};

function loadConfig() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }; }
  catch { return JSON.parse(JSON.stringify(DEFAULTS)); }
}
function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

let win = null;
let tray = null;
let config = loadConfig();

function peekSpot(y) {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: Math.round(workArea.x + workArea.width - PEEK_W - PEEK_MARGIN),
    y: Math.round(y != null ? y : workArea.y + Math.round(workArea.height * 0.25))
  };
}

function topRight() {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: Math.round(workArea.x + workArea.width - WIDTH - MARGIN),
    y: Math.round(workArea.y + MARGIN)
  };
}

function createWindow() {
  const pos = config.pos || topRight();
  win = new BrowserWindow({
    width: WIDTH,
    height: COMPACT_H,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });

  // Float above full-screen apps too (so it survives a full-screen browser).
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile('index.html');

  win.on('moved', () => {
    if (peeked) return;              // the tab is docked; don't overwrite the card spot
    const [x, y] = win.getPosition();
    config.pos = { x, y };
    saveConfig(config);
  });
}

function trayIcon() {
  // Small clock glyph drawn as a template image so it adapts to the menu bar.
  // The brand mark, flattened to a silhouette so macOS can tint it.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 512 512">
    <defs><mask id="t" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512">
      <rect width="512" height="512" fill="#fff"/>
      <rect x="300" y="125" width="86" height="86" fill="#000"/>
    </mask></defs>
    <circle cx="256" cy="256" r="101" fill="none" stroke="black" stroke-width="58" mask="url(#t)"/>
    <rect x="308" y="133" width="70" height="70" fill="black"/>
  </svg>`;
  const img = nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
  img.setTemplateImage(true);
  return img;
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible()) win.hide(); else win.showInactive();
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('Client Clock');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show / hide  (⌘⇧K)', click: toggleWindow },
    { label: 'Snap to top-right', click: () => {
        setPeek(false);
        const p = topRight();
        win.setPosition(p.x, p.y);
        config.pos = p; saveConfig(config);
      } },
    { type: 'separator' },
    { label: 'Quit Client Clock', click: () => app.quit() }
  ]));
  tray.on('click', toggleWindow);
}

// Only ever one card on screen: a second launch just reveals the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    win.showInactive();
    win.setAlwaysOnTop(true, 'floating');
  });

  app.whenReady().then(() => {
    if (app.dock) app.dock.hide(); // menu-bar utility, not a Dock app
    createWindow();
    createTray();
    globalShortcut.register('CommandOrControl+Shift+K', toggleWindow);
  });
}

app.on('window-all-closed', (e) => e.preventDefault());

// ---------------------------------------------------------------------------
// Bridge: the Chrome extension posts whoever you're looking at on Dribbble.
// Loopback only — nothing outside this machine can reach it.
// ---------------------------------------------------------------------------
function allowedOrigin(origin) {
  return !origin || origin.startsWith('chrome-extension://') || origin === 'https://dribbble.com';
}

// Last thing the extension told us — purely so you can check the bridge works.
let lastSeen = null;

const bridge = http.createServer((req, res) => {
  const origin = req.headers.origin;
  if (!allowedOrigin(origin)) { res.writeHead(403).end(); return; }
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');

  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  if (req.method === 'GET' && (req.url === '/ping' || req.url === '/status')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      app: 'client-clock',
      extensionSeen: !!lastSeen,
      collapsed: peeked,
      bounds: win ? win.getBounds() : null,
      lastSeen,
      secondsAgo: lastSeen ? Math.round((Date.now() - lastSeen.at) / 1000) : null
    }));
    return;
  }
  // Chrome says you've navigated off the conversation — collapse right away.
  if (req.method === 'POST' && req.url === '/idle') {
    lastSeen = null;
    if (win) win.webContents.send('auto:idle');
    res.writeHead(204).end();
    return;
  }
  if (req.method !== 'POST' || req.url !== '/active') { res.writeHead(404).end(); return; }

  let body = '';
  req.on('data', (c) => {
    body += c;
    if (body.length > 16 * 1024) { req.destroy(); }   // nothing legitimate is this big
  });
  req.on('end', () => {
    let data;
    try { data = JSON.parse(body); } catch { res.writeHead(400).end(); return; }

    // Only the shape we expect ever reaches the window.
    const payload = {
      key: String(data.key || '').slice(0, 120),
      name: String(data.name || '').slice(0, 80),
      url: String(data.url || '').slice(0, 300),
      source: data.source === 'profile' ? 'profile' : 'conversation',
      candidates: Array.isArray(data.candidates)
        ? data.candidates.filter(c => typeof c === 'string').map(c => c.slice(0, 64)).slice(0, 30)
        : []
    };
    if (payload.name) {
      lastSeen = { name: payload.name, key: payload.key, candidates: payload.candidates, at: Date.now() };
      if (win) win.webContents.send('auto:prospect', payload);
    }
    res.writeHead(204).end();
  });
});

bridge.on('error', (err) => console.error('[client-clock] bridge:', err.message));
bridge.listen(BRIDGE_PORT, '127.0.0.1');

// Chrome stops talking when the tab closes or Chrome quits; fall quiet too.
setInterval(() => {
  if (!lastSeen || !win) return;
  if (Date.now() - lastSeen.at > IDLE_MS) {
    lastSeen = null;
    win.webContents.send('auto:idle');
  }
}, 15000);

ipcMain.handle('config:get', () => config);
ipcMain.handle('config:set', (_e, next) => {
  config = { ...config, ...next };
  saveConfig(config);
  return config;
});
ipcMain.on('ui:expand', (_e, expanded) => {
  if (!win) return;
  win.setBounds({ ...win.getBounds(), height: expanded ? EXPANDED_H : COMPACT_H });
});
// The card grows a little when it needs to warn about an ambiguous zone.
ipcMain.on('ui:height', (_e, h) => {
  if (!win || peeked) return;   // the collapsed tab has a fixed size
  const next = Math.max(90, Math.min(700, Math.round(h)));
  const b = win.getBounds();
  if (Math.abs(b.height - next) > 1) win.setBounds({ ...b, height: next });
});
ipcMain.on('ui:hide', () => win && win.hide());

// Collapsed ⇄ open. The card's own position is remembered, so opening the tab
// puts the card back exactly where you last left it.
let peeked = false;

ipcMain.on('ui:peek', (_e, next) => setPeek(!!next));

function setPeek(next) {
  if (!win || peeked === next) return;
  const b = win.getBounds();
  const target = next
    ? { ...peekSpot(b.y), width: PEEK_W, height: PEEK_H }
    : { ...(config.pos || topRight()), width: WIDTH, height: COMPACT_H };

  if (next) {
    config.pos = { x: b.x, y: b.y };          // remember where the card was
    saveConfig(config);
  }

  // Resizing a transparent window on macOS leaves the old frame's pixels in
  // the buffer — collapsing from the card left a dark slab sitting next to the
  // tab. Cycling visibility around the resize forces a clean surface.
  const wasVisible = win.isVisible();
  if (wasVisible) win.hide();
  win.setBounds(target);
  peeked = next;
  if (win.webContents) win.webContents.send('ui:peeked', next);
  if (wasVisible) {
    win.showInactive();
    win.setAlwaysOnTop(true, 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
}
