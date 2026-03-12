import { app } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function setupPerformanceOptimizations() {
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('disable-dev-shm-usage');
  app.commandLine.appendSwitch('disable-extensions');
  app.commandLine.appendSwitch('disable-plugins');
  app.commandLine.appendSwitch('disable-images', 'false');
  app.commandLine.appendSwitch('disable-javascript', 'false');
  app.commandLine.appendSwitch('disable-web-security', 'false');
  app.commandLine.appendSwitch('disable-features', 'Translate');
  app.commandLine.appendSwitch(
    'enable-features',
    'PlatformEncryptedFiles,WinRetrieveFileIdOnlyOnce'
  );

  app.commandLine.appendSwitch('js-flags', '--max-old-space-size=128');

  if (process.platform === 'win32') {
    app.setAppUserModelId('com.oos.opencode-switch');
  }

  app.disableHardwareAcceleration(false);
}

export function getMemoryUsage() {
  const memoryUsage = process.memoryUsage();
  return {
    heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
    heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
    rss: Math.round(memoryUsage.rss / 1024 / 1024),
    external: Math.round(memoryUsage.external / 1024 / 1024),
  };
}

export function checkPerformanceBudget() {
  const memory = getMemoryUsage();
  const budget = {
    maxHeapMB: 150,
    maxRSSMB: 200,
  };

  const violations = [];

  if (memory.heapUsed > budget.maxHeapMB) {
    violations.push(`Heap usage (${memory.heapUsed}MB) exceeds budget (${budget.maxHeapMB}MB)`);
  }

  if (memory.rss > budget.maxRSSMB) {
    violations.push(`RSS (${memory.rss}MB) exceeds budget (${budget.maxRSSMB}MB)`);
  }

  return {
    withinBudget: violations.length === 0,
    memory,
    budget,
    violations,
  };
}

export default {
  setupPerformanceOptimizations,
  getMemoryUsage,
  checkPerformanceBudget,
};
