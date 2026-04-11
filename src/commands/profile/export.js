import readline from 'readline';
import path from 'path';
import { ProfileManager } from '../../core/ProfileManager.js';
import { logger } from '../../utils/logger.js';
import { exists } from '../../utils/files.js';

async function confirmOverwrite(targetPath) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise((resolve) =>
    rl.question(`File exists at "${targetPath}". Overwrite? [y/N] `, (ans) => {
      rl.close();
      resolve(ans.toLowerCase());
    })
  );

  return answer === 'y' || answer === 'yes';
}

export async function exportAction(name, options) {
  const manager = new ProfileManager();

  let exportPath;
  if (options && options.output) {
    exportPath = options.output;
  } else {
    exportPath = path.join(process.cwd(), `${name}.export.json`);
  }

  if ((await exists(exportPath)) && !options?.force) {
    const canOverwrite = await confirmOverwrite(exportPath);
    if (!canOverwrite) {
      logger.info('Export cancelled');
      return;
    }
  }

  const exportObj = await manager.exportProfile(name, { outputPath: exportPath });
  logger.success(`Exported profile "${exportObj.profile}" to "${exportPath}"`);
}

export function registerExportCommand(program) {
  program
    .command('export <name>')
    .description('Export a profile to a JSON export file')
    .option('-f, --force', 'Skip confirmation prompts')
    .option('-o, --output <path>', 'Output export file path')
    .action(exportAction);
}
