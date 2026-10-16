const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clock', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (next) => ipcRenderer.invoke('config:set', next),
  expand: (expanded) => ipcRenderer.send('ui:expand', expanded),
  setHeight: (h) => ipcRenderer.send('ui:height', h),
  peek: (on) => ipcRenderer.send('ui:peek', on),
  hide: () => ipcRenderer.send('ui:hide'),
  // Whoever Chrome says you're looking at right now.
  onProspect: (cb) => ipcRenderer.on('auto:prospect', (_e, p) => cb(p)),
  // Chrome went quiet: no conversation open any more.
  onIdle: (cb) => ipcRenderer.on('auto:idle', () => cb()),
  onPeeked: (cb) => ipcRenderer.on('ui:peeked', (_e, on) => cb(on))
});
