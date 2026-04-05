import { getModels } from '../tui/model-aggregator.js';
import logger from '../utils/logger.js';

const sourceToDisplay = {
  'opencode.json': 'config',
  'auth list': 'auth',
  models: 'official',
};

export async function modelsAction(_options) {
  const models = await getModels();

  const grouped = new Map();
  for (const item of models) {
    if (!grouped.has(item.provider)) {
      grouped.set(item.provider, {
        source: sourceToDisplay[item.source] || item.source,
        models: new Set(),
      });
    }
    for (const model of item.models) {
      grouped.get(item.provider).models.add(model);
    }
  }

  const sortedProviders = Array.from(grouped.keys()).sort();

  for (const provider of sortedProviders) {
    const { source, models: modelSet } = grouped.get(provider);
    logger.raw(`${provider} [${source}]`);
    for (const model of Array.from(modelSet).sort()) {
      logger.raw(`  - ${model}`);
    }
  }
}

export function registerModelsCommand(program) {
  program.command('models').description('List available models').action(modelsAction);
}
