import { ConfigManager } from '../core/ConfigManager.js';
import { logger } from '../utils/logger.js';
import { getCachedSchema } from '../utils/schemaFetcher.js';
import Ajv from 'ajv';

export async function validateAction(_options) {
  logger.info('Validating current configuration...');

  // Fetch schema
  const { schema, error: schemaError } = await getCachedSchema();

  if (schemaError || !schema) {
    logger.error(`Failed to fetch schema: ${schemaError}`);
    process.exit(1);
  }

  // Read config
  const manager = new ConfigManager();
  let config;

  try {
    config = await manager.readConfig();
  } catch (error) {
    logger.error(`Failed to read config: ${error.message}`);
    process.exit(1);
  }

  // Validate against schema
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);
  const valid = validate(config);

  if (valid) {
    logger.success('✓ Configuration is valid');
    process.exit(0);
  } else {
    logger.error('Validation failed:');

    if (validate.errors) {
      for (const error of validate.errors) {
        const path = error.instancePath || '/';
        logger.raw(`  ${path}: ${error.message}`);
      }
    }

    process.exit(2);
  }
}

export function registerValidateCommand(program) {
  program.command('validate').description('Validate current configuration').action(validateAction);
}
