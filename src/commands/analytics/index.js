import { registerSummaryCommand } from './summary.js';
import { registerModelsCommand } from './models.js';
import { registerAgentsCommand } from './agents.js';
import { registerCategoriesCommand } from './categories.js';
import { registerExportCommand } from './export.js';

export function registerAnalyticsCommands(program) {
  const analytics = program.command('analytics').description('Analytics and usage statistics');

  registerSummaryCommand(analytics);
  registerModelsCommand(analytics);
  registerAgentsCommand(analytics);
  registerCategoriesCommand(analytics);
  registerExportCommand(analytics);
}
