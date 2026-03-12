import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { createWindow } from './window.js';
import { registerProfileHandlers } from './ipc/profileHandlers.js';
import { setupPerformanceOptimizations } from './performance.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (global.mainWindow) {
      if (global.mainWindow.isMinimized()) {
        global.mainWindow.restore();
      }
      global.mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    setupPerformanceOptimizations();

    global.mainWindow = createWindow();
    registerProfileHandlers(ipcMain);

    global.mainWindow.on('closed', () => {
      global.mainWindow = null;
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      global.mainWindow = createWindow();
    }
  });
}
