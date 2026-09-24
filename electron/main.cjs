const electron = require('electron');
const path = require('path');

// If executed directly with Node.js instead of Electron, re-spawn with Electron executable
if (typeof electron === 'string') {
  const { spawn } = require('child_process');
  const appRoot = path.join(__dirname, '..');
  const child = spawn(electron, [appRoot, ...process.argv.slice(2)], {
    stdio: 'inherit',
    windowsHide: false,
  });
  child.on('close', (code) => {
    process.exit(code ?? 0);
  });
} else {
  const { app, BrowserWindow, shell } = electron;

  function createWindow() {
    const mainWindow = new BrowserWindow({
      width: 1280,
      height: 850,
      minWidth: 960,
      minHeight: 600,
      title: 'TcPouStatechartGenerator',
      backgroundColor: '#020617', // slate-950
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
      autoHideMenuBar: true,
    });

    // Open external links (like mermaid.live) in the user's default browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https:') || url.startsWith('http:')) {
        shell.openExternal(url);
        return { action: 'deny' };
      }
      return { action: 'allow' };
    });

    const devUrl = process.env.VITE_DEV_SERVER_URL;
    if (devUrl) {
      mainWindow.loadURL(devUrl);
    } else {
      mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }
  }

  app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
