const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen, globalShortcut } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');

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
const IDLE_MS = +process.env.CC_IDLE_MS || 60 * 1000;

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

// ---------------------------------------------------------------------------
// Start at login, via a launchd agent — so the clock is already there when you
// open Chrome, and comes back by itself after a restart.
// ---------------------------------------------------------------------------
const PLIST_LABEL = 'com.aman.client-clock';
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${PLIST_LABEL}.plist`);

function plistContents() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${app.getAppPath()}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>/tmp/client-clock.log</string>
  <key>StandardErrorPath</key><string>/tmp/client-clock.err</string>
</dict>
</plist>
`;
}

const autostartEnabled = () => fs.existsSync(PLIST_PATH);

function setAutostart(on) {
  try {
    if (on) {
      fs.mkdirSync(path.dirname(PLIST_PATH), { recursive: true });
      fs.writeFileSync(PLIST_PATH, plistContents());
      // Quitting from the tray should stay quit, so only load it for future
      // logins rather than kicking off a second copy right now.
      execFile('/bin/launchctl', ['load', '-w', PLIST_PATH], () => {});
    } else {
      execFile('/bin/launchctl', ['unload', '-w', PLIST_PATH], () => {
        try { fs.unlinkSync(PLIST_PATH); } catch {}
      });
    }
  } catch (e) {
    console.error('[client-clock] autostart:', e.message);
  }
}

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

// Keep the window wholly on whichever screen it is being dragged across, so
// "all the way down" stops at the edge instead of disappearing past it.
function clampToScreen(x, y, w, h, near) {
  const d = near ? screen.getDisplayNearestPoint(near) : screen.getPrimaryDisplay();
  const a = d.workArea;
  return {
    x: Math.round(Math.min(Math.max(x, a.x), a.x + a.width - w)),
    y: Math.round(Math.min(Math.max(y, a.y), a.y + a.height - h))
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

  // Covers the card's own native drag region as well as our tab dragging.
  win.on('moved', () => { if (!dragTimer) rememberSpot(); });
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

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Show / hide  (⌘⇧K)', click: toggleWindow },
    { label: 'Snap to top-right', click: () => {
        setPeek(false);
        const p = topRight();
        win.setPosition(p.x, p.y);
        config.pos = p; saveConfig(config);
      } },
    { type: 'separator' },
    {
      label: 'Start at login',
      type: 'checkbox',
      checked: autostartEnabled(),
      click: (item) => { setAutostart(item.checked); tray.setContextMenu(buildTrayMenu()); }
    },
    { type: 'separator' },
    { label: 'Quit Client Clock', click: () => app.quit() }
  ]);
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('Client Clock');
  tray.setContextMenu(buildTrayMenu());
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
    // "Always on" means it should be back after a restart, without being asked.
    // Turn it off any time from the tray.
    if (!autostartEnabled()) setAutostart(true);
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
let lastPresentAt = 0;   // last time Chrome said you were anywhere on Dribbble

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
  // Still on Dribbble, just not in a conversation: stay open, stay awake.
  if (req.method === 'POST' && req.url === '/present') {
    lastPresentAt = Date.now();
    if (lastSeen) lastSeen.at = lastPresentAt;  // don't let the watchdog fold it
    if (win) win.webContents.send('auto:present');
    res.writeHead(204).end();
    return;
  }
  // Chrome says you've navigated off the conversation — collapse right away.
  if (req.method === 'POST' && req.url === '/idle') {
    lastSeen = null;
    lastPresentAt = 0;
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
      lastPresentAt = Date.now();
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
  if (!win) return;
  const heard = Math.max(lastSeen ? lastSeen.at : 0, lastPresentAt);
  if (!heard) return;
  if (Date.now() - heard > IDLE_MS) {
    lastSeen = null;
    lastPresentAt = 0;
    win.webContents.send('auto:idle');
  }
}, 5000);

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
  if (Math.abs(b.height - next) > 1) {
    // Growing downward must not run off the bottom of the screen.
    const pos = clampToScreen(b.x, b.y, b.width, next, { x: b.x, y: b.y });
    win.setBounds({ x: pos.x, y: pos.y, width: b.width, height: next });
  }
});
ipcMain.on('ui:hide', () => win && win.hide());

// Collapsed ⇄ open. The card's own position is remembered, so opening the tab
// puts the card back exactly where you last left it.
let peeked = false;

// The collapsed tab is 52px of click target, so a drag started on it will
// leave the window within a frame or two. Following the OS cursor from the
// main process keeps it glued to the pointer no matter how fast you throw it.
let dragTimer = null;
let dragState = null;

ipcMain.on('ui:dragStart', () => {
  if (!win) return;
  const p = screen.getCursorScreenPoint();
  const b = win.getBounds();
  dragState = { dx: p.x - b.x, dy: p.y - b.y, moved: 0, started: Date.now() };
  clearInterval(dragTimer);
  dragTimer = setInterval(() => {
    if (!win || !dragState) return stopDrag();
    // Never leave the window stuck to the cursor if a mouseup goes missing.
    if (Date.now() - dragState.started > 15000) return stopDrag();
    const c = screen.getCursorScreenPoint();
    const b2 = win.getBounds();
    // Docked tab: vertical only, so it stays flush with the screen edge.
    const wantX = peeked ? b2.x : c.x - dragState.dx;
    const wantY = c.y - dragState.dy;
    const pos = clampToScreen(wantX, wantY, b2.width, b2.height, c);
    dragState.moved += Math.abs(pos.x - b2.x) + Math.abs(pos.y - b2.y);
    if (pos.x !== b2.x || pos.y !== b2.y) win.setPosition(pos.x, pos.y);
  }, 16);
});

ipcMain.handle('ui:dragEnd', () => {
  const moved = dragState ? dragState.moved : 0;
  stopDrag();
  return { moved: moved > 3 };
});

function stopDrag() {
  clearInterval(dragTimer);
  dragTimer = null;
  dragState = null;
  rememberSpot();
}

// One vertical position for both states: drag the tab, and the card opens
// where you left it.
function rememberSpot() {
  if (!win) return;
  const b = win.getBounds();
  const cardX = (config.pos && config.pos.x != null) ? config.pos.x : topRight().x;
  config.pos = peeked ? { x: cardX, y: b.y } : { x: b.x, y: b.y };
  saveConfig(config);
}

ipcMain.on('ui:peek', (_e, next) => setPeek(!!next));

function setPeek(next) {
  if (!win || peeked === next) return;
  const b = win.getBounds();
  const spot = config.pos || topRight();
  const target = next
    ? { ...peekSpot(b.y), width: PEEK_W, height: PEEK_H }
    // Opening is taller than the tab, so a tab parked at the bottom edge would
    // otherwise push the card off-screen.
    : { ...clampToScreen(spot.x, spot.y, WIDTH, COMPACT_H), width: WIDTH, height: COMPACT_H };

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
