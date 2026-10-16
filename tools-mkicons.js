// Render the SVG logo once at high resolution, then downscale — one window only,
// because Electron refuses a second load in a loop like this.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE = 256;
const SIZES = [128, 48, 32, 16];
const OUT = process.argv[2];
const SVG = fs.readFileSync(process.argv[3], 'utf8');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ccicons-'));

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(TMP, 'icon.html');
  fs.writeFileSync(file, `<meta charset="utf-8"><style>
    html,body{margin:0;width:${BASE}px;height:${BASE}px;background:transparent;overflow:hidden}
    svg{width:${BASE}px;height:${BASE}px;display:block}</style>${SVG}`);

  const w = new BrowserWindow({
    width: BASE, height: BASE, show: false, frame: false,
    transparent: true, backgroundColor: '#00000000', useContentSize: true
  });
  await w.loadFile(file);
  await new Promise(r => setTimeout(r, 400));
  const shot = await w.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, 'icon256.png'), shot.toPNG());

  for (const size of SIZES) {
    const img = shot.resize({ width: size, height: size, quality: 'best' });
    fs.writeFileSync(path.join(OUT, `icon${size}.png`), img.toPNG());
    console.log('WROTE', size);
  }
  w.destroy();
  console.log('DONE');
  app.exit(0);
});
