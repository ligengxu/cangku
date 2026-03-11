const { app, BrowserWindow, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');

const REMOTE_URL = 'https://mz.mzwkj.com';
const APP_TITLE = '果管系统 v2.0';

let mainWindow = null;
let tray = null;
let isQuitting = false;

function getIconPath() {
  const iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const devPath = path.join(__dirname, '..', 'public', iconName);
  const prodPath = path.join(process.resourcesPath, iconName);
  try {
    require('fs').accessSync(devPath);
    return devPath;
  } catch {
    try {
      require('fs').accessSync(prodPath);
      return prodPath;
    } catch {
      return undefined;
    }
  }
}

function createSplashWindow() {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const splashW = 480;
  const splashH = 320;

  const splash = new BrowserWindow({
    width: splashW,
    height: splashH,
    x: Math.round((screenW - splashW) / 2),
    y: Math.round((screenH - splashH) / 2),
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${splashW}px; height: ${splashH}px;
    display: flex; align-items: center; justify-content: center;
    background: transparent; font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
    -webkit-app-region: drag; user-select: none;
  }
  .card {
    width: 100%; height: 100%; border-radius: 20px;
    background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0f172a 100%);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    position: relative; overflow: hidden;
  }
  .card::before {
    content: ''; position: absolute; top: -50%; left: -50%;
    width: 200%; height: 200%;
    background: conic-gradient(from 0deg, transparent, rgba(56,189,248,0.08), transparent 30%);
    animation: rotate 4s linear infinite;
  }
  @keyframes rotate { to { transform: rotate(360deg); } }
  .icon {
    font-size: 56px; margin-bottom: 16px; position: relative; z-index: 1;
    animation: bounce 2s ease-in-out infinite;
  }
  @keyframes bounce {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-8px); }
  }
  .title {
    font-size: 26px; font-weight: 700; color: #f0f9ff;
    letter-spacing: 3px; position: relative; z-index: 1;
  }
  .sub {
    font-size: 13px; color: #94a3b8; margin-top: 8px;
    position: relative; z-index: 1;
  }
  .loader {
    margin-top: 28px; position: relative; z-index: 1;
    width: 120px; height: 3px; background: rgba(255,255,255,0.1);
    border-radius: 3px; overflow: hidden;
  }
  .loader::after {
    content: ''; position: absolute; top: 0; left: -40%;
    width: 40%; height: 100%; border-radius: 3px;
    background: linear-gradient(90deg, transparent, #38bdf8, transparent);
    animation: slide 1.2s ease-in-out infinite;
  }
  @keyframes slide {
    0% { left: -40%; }
    100% { left: 100%; }
  }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">🍊</div>
    <div class="title">果管系统</div>
    <div class="sub">正在连接服务器...</div>
    <div class="loader"></div>
  </div>
</body>
</html>
  `)}`);

  return splash;
}

function createMainWindow() {
  const iconPath = getIconPath();

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: APP_TITLE,
    icon: iconPath,
    show: false,
    frame: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.setTitle(APP_TITLE);

  mainWindow.on('page-title-updated', (e) => {
    e.preventDefault();
    mainWindow.setTitle(APP_TITLE);
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function createTray() {
  const iconPath = getIconPath();
  let trayIcon;

  if (iconPath) {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } else {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip(APP_TITLE);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  const splash = createSplashWindow();
  const win = createMainWindow();

  createTray();

  win.loadURL(REMOTE_URL);

  win.webContents.on('did-finish-load', () => {
    setTimeout(() => {
      splash.destroy();
      win.show();
      win.focus();
    }, 800);
  });

  win.webContents.on('did-fail-load', (_e, errorCode, errorDesc) => {
    splash.destroy();
    win.show();
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
<!DOCTYPE html>
<html>
<head>
<style>
  body {
    margin: 0; height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #0f172a; color: #e2e8f0;
    font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
  }
  .box { text-align: center; }
  h2 { font-size: 22px; margin-bottom: 12px; color: #f87171; }
  p { font-size: 14px; color: #94a3b8; margin: 6px 0; }
  button {
    margin-top: 24px; padding: 10px 32px; border: none; border-radius: 8px;
    background: #2563eb; color: #fff; font-size: 15px; cursor: pointer;
  }
  button:hover { background: #1d4ed8; }
</style>
</head>
<body>
  <div class="box">
    <h2>连接失败</h2>
    <p>无法连接到服务器 ${REMOTE_URL}</p>
    <p style="font-size:12px;color:#64748b;">错误: ${errorDesc} (${errorCode})</p>
    <button onclick="location.href='${REMOTE_URL}'">重新连接</button>
  </div>
</body>
</html>
    `)}`);
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
  }
});
