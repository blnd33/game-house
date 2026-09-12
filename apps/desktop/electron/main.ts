import { app, BrowserWindow, ipcMain, session, type IpcMainInvokeEvent } from 'electron';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEFAULT_PIPE } from './agent-client.js';
import { NativeStation } from './native.js';

const uiTest = !app.isPackaged && process.argv.includes('--ui-test');
const nativeTest = !app.isPackaged && process.argv.includes('--native-test');
const devAgent = !app.isPackaged && process.argv.includes('--dev-agent');
const sampleMode = !app.isPackaged && (uiTest || process.argv.includes('--sample'));
const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const entry = fileURLToPath(new URL('../dist/index.html', import.meta.url));
const trustedUrl = pathToFileURL(entry).href;
let window: BrowserWindow | null = null;

/** Development only. On venue PCs the agent runs as a Windows Service (Phase 5). */
function startDevelopmentAgent(): void {
  const agent = spawn(join(projectRoot, 'services', 'station-agent', 'bin', 'Debug', 'net10.0-windows', 'GamingHouse.Agent.exe'),
    ['run', '--dev', '--config-dir', join(projectRoot, 'config', 'dev-station'), '--pipe', DEFAULT_PIPE],
    { stdio: 'ignore', windowsHide: true, detached: true });
  agent.on('error', error => console.error(`Development agent did not start: ${error.message}`));
  agent.unref(); // UI restarts do not terminate durable monitoring.
}

app.enableSandbox();
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.restore(); window?.focus(); });
  app.whenReady().then(async () => {
    if (nativeTest) {
      const { runNativeTest } = await import('./native-test.js');
      app.exit(await runNativeTest(projectRoot, app.getVersion()) ? 0 : 1);
      return;
    }
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    window = new BrowserWindow({
      width: 1600, height: 900, minWidth: 1024, minHeight: 640,
      show: false, backgroundColor: '#080808', title: 'Gaming House',
      webPreferences: {
        preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
        contextIsolation: true, sandbox: true, nodeIntegration: false,
        webSecurity: true, devTools: !app.isPackaged,
        // The test window renders offscreen so it produces real frames without being
        // shown, and keeps timers and the Page Visibility API live.
        backgroundThrottling: !uiTest, offscreen: uiTest,
      },
    });
    window.removeMenu();
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());

    const trusted = (event: IpcMainInvokeEvent) => event.sender === window?.webContents
      && event.senderFrame === event.sender.mainFrame && event.senderFrame?.url === trustedUrl;
    let native: NativeStation | null = null;
    if (!uiTest) { // the UI test always uses the development sample only
      if (devAgent) startDevelopmentAgent();
      native = new NativeStation(DEFAULT_PIPE, app.getVersion(), app.isPackaged ? join(process.resourcesPath, '..', '..', 'agent', 'GamingHouse.Agent.exe') : undefined);
      await native.start(devAgent ? 8000 : 1000);
      native.attach(window, trusted);
    }
    ipcMain.handle('host:info', (event, ...args: unknown[]) => {
      if (!trusted(event) || args.length !== 0) throw new Error('IPC request rejected');
      // Phase 3: real launching when the agent is connected; no backend yet.
      return { phase: 4, nativeLaunchAvailable: native?.agent.connected ?? false, sampleMode };
    });

    if (!uiTest) window.once('ready-to-show', () => { window?.maximize(); window?.show(); });
    await window.loadFile(entry);
    if (uiTest) {
      const { runUiTest } = await import('./ui-test.js');
      app.exit(await runUiTest(window, new URL('../../../artifacts/', import.meta.url)) ? 0 : 1);
    }
  }).catch((error: unknown) => { console.error(error); app.exit(1); });
  app.on('window-all-closed', () => app.quit());
}
