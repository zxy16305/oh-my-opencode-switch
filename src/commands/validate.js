import { program } from 'commander';
import { ConfigManager } from '../core/ConfigManager.js';
import { logger } from '../utils/logger.js';
import { getCachedSchema } from '../utils/schemaFetcher.js';
import Ajv from 'ajv';

export async function validateAction(_options) {
  logger.info('Validating current configuration...');

  // Fetch schema
  const { schema, error: schemaError } = await getCachedSchema();

  if (schemaError || !schema) {
    program.error(`Failed to fetch OpenCode config schema: ${schemaError}`, { exitCode: 1 });
  }

  // Read config
  const manager = new ConfigManager();
  let config;

  try {
    config = await manager.readConfig();
  } catch (error) {
    program.error(`Failed to read config: ${error.message}`, { exitCode: 1 });
  }

  // Validate against schema
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);
  const valid = validate(config);

  if (valid) {
    logger.success('✓ Configuration is valid');
    return;
  } else {
    logger.error('Validation failed:');

    if (validate.errors) {
      for (const error of validate.errors) {
        const path = error.instancePath || '/';
        logger.raw(`  ${path}: ${error.message}`);
      }
    }

    program.error(
      `Configuration validation failed: ${validate.errors.map((e) => e.message).join('; ')}`,
      { exitCode: 2 }
    );
  }
}

export function registerValidateCommand(program) {
  program.command('validate').description('Validate current configuration').action(validateAction);
}
