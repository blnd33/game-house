import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

// The renderer's entire native surface: host info, the verified catalog, "launch
// this game ID", and display-safe launch events. No paths, commands or credentials.
contextBridge.exposeInMainWorld('gamingHouse', Object.freeze({
  hostInfo: async () => ({
    ...await ipcRenderer.invoke('host:info'),
    sandboxed: process.sandboxed,
    contextIsolated: process.contextIsolated,
  }),
  native: Object.freeze({
    catalog: () => ipcRenderer.invoke('native:catalog'),
    state: () => ipcRenderer.invoke('native:state'),
    launch: (gameId: string) => ipcRenderer.invoke('native:launch', String(gameId)),
    onEvent: (listener: (event: unknown) => void) => {
      const handler = (_event: IpcRendererEvent, payload: unknown) => listener(payload);
      ipcRenderer.on('native:event', handler);
      return () => { ipcRenderer.removeListener('native:event', handler); };
    },
  }),
}));
