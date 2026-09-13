const { app, BrowserWindow, dialog, session } = require('electron');

// Every desktop connects to the same hospital server; no isolated patient database.
const serverUrl = process.env.HIMS_SERVER_URL || 'http://127.0.0.1:3000';
let window;
function createWindow() {
  const target = new URL(serverUrl);
  if (target.username || target.password || (target.protocol !== 'https:' && !(target.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(target.hostname)))) {
    throw new Error('Use an HTTPS hospital server address. HTTP is permitted only on localhost.');
  }
  window = new BrowserWindow({
    width: 1440, height: 960, minWidth: 740, minHeight: 600,
    show: process.env.HIMS_DESKTOP_TEST !== 'true',
    title: 'Carepoint Hospital IMS', backgroundColor: '#f5f7f6', autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, spellcheck: false }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== target.origin) event.preventDefault();
  });
  window.webContents.on('will-redirect', (event, url) => {
    if (new URL(url).origin !== target.origin) event.preventDefault();
  });
  window.loadURL(target.href).catch(() => {
    dialog.showErrorBox('Hospital server unavailable', 'Start the hospital server, or check HIMS_SERVER_URL and your connection. Then reopen Carepoint.');
    app.quit();
  });
}
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.on('will-download', event => event.preventDefault());
  createWindow();
}).catch(error => { dialog.showErrorBox('Unable to start Carepoint', error.message); app.quit(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
