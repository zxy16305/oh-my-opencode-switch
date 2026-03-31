import path from 'path';
import fs from 'fs';
import readline from 'readline';
import logger from '../../utils/logger.js';
import ProfileManager from '../../core/ProfileManager.js';

export async function importAction(file) {
  const filePath = path.resolve(file);
  if (!fs.existsSync(filePath)) {
    logger.error(`Import file not found: ${filePath}`);
    throw new Error('Import file not found');
  }
  let importData;
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    importData = JSON.parse(raw);
  } catch (err) {
    logger.error(`Failed to read or parse import file: ${filePath}`);
    throw err;
  }

  const baseName = (
    (importData && (importData.profile || importData.name || importData.profileName)) ||
    'imported'
  ).toString();
  let finalName = baseName.trim();

  const manager = new ProfileManager();

  let exists = false;
  try {
    const existing = await manager.getProfile(finalName);
    exists = !!existing;
  } catch (e) {
    exists = false;
  }

  if (exists) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolve) =>
      rl.question(
        `Profile "${finalName}" already exists. Overwrite (o), Rename to "${finalName}-1" (r), Skip (s)? [o/r/s]: `,
        resolve
      )
    );
    rl.close();

    const choice = (answer || '').trim().toLowerCase();
    if (choice.startsWith('o')) {
      // overwrite, keep finalName
    } else if (choice.startsWith('r')) {
      // rename to next available suffix
      let idx = 1;
      let candidate = `${finalName}-${idx}`;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          const existsNow = manager.getProfile(candidate);
          if (!existsNow) break;
        } catch {
          // not exist, can use
          break;
        }
        idx += 1;
        candidate = `${finalName}-${idx}`;
      }
      finalName = candidate;
    } else {
      // skip import
      logger.info('Import skipped by user.');
      return { success: false, name: finalName, skipped: true };
    }
  }

  // Perform the import
  await manager.importProfile(filePath, { name: finalName });
  logger.info(`Imported profile "${finalName}" from ${path.basename(filePath)}`);
  return { success: true, name: finalName };
}

// Register the import command on the provided Commander program
export function registerImportCommand(program) {
  program
    .command('import <file>')
    .description('Import a profile from a JSON file')
    .action(async (file) => {
      try {
        await importAction(file);
      } catch (err) {
        logger.error(err?.message || err);
        program.error(err?.message || 'Import failed');
      }
    });
}

export default { importAction, registerImportCommand };
