#!/usr/bin/env node

import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync, cpSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const distDir = resolve(rootDir, 'dist');

console.log('🔨 Building OOS Electron App...\n');

console.log('1. Cleaning dist directory...');
if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true, force: true });
}
mkdirSync(distDir, { recursive: true });

console.log('2. Building Vue renderer...');
execSync('npm run electron:build', { cwd: rootDir, stdio: 'inherit' });

console.log('\n3. Copying Electron main process files...');
const electronSrc = resolve(rootDir, 'src/electron');
const electronDest = resolve(distDir, 'electron');
mkdirSync(electronDest, { recursive: true });
cpSync(electronSrc, electronDest, { recursive: true });

console.log('4. Copying shared modules...');
const sharedSrc = resolve(rootDir, 'src/shared');
const sharedDest = resolve(distDir, 'shared');
cpSync(sharedSrc, sharedDest, { recursive: true });

console.log('5. Copying core modules...');
const coreSrc = resolve(rootDir, 'src/core');
const coreDest = resolve(distDir, 'core');
cpSync(coreSrc, coreDest, { recursive: true });

console.log('6. Copying utilities...');
const utilsSrc = resolve(rootDir, 'src/utils');
const utilsDest = resolve(distDir, 'utils');
cpSync(utilsSrc, utilsDest, { recursive: true });

console.log('\n✅ Build complete!');
console.log(`   Output: ${distDir}`);
