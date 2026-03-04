import fs from 'fs/promises';
import { ProfileManager } from '../core/ProfileManager.js';
import { TemplateEngine } from '../core/TemplateEngine.js';
import { getTemplatePath, getVariablesPath, hasTemplate, hasVariables } from '../utils/paths.js';
import { readJson } from '../utils/files.js';
import { logger } from '../utils/logger.js';
import { MissingVariableError, ProfileError, FileSystemError } from '../utils/errors.js';

/**
 * Render a profile's template with variables
 * @param {string} profileName - Name of the profile
 * @param {object} options - Command options
 * @param {string} [options.output] - Output file path
 */
export async function renderAction(profileName, options = {}) {
  const manager = new ProfileManager();
  const profile = await manager.getProfile(profileName);
  if (!profile) {
    throw new ProfileError(`Profile '${profileName}' not found`);
  }

  const templateExists = await hasTemplate(profileName);
  if (!templateExists) {
    throw new ProfileError(
      `Profile '${profileName}' does not have a template. ` +
        `Use 'oos template create ${profileName}' to create one.`
    );
  }

  const templatePath = getTemplatePath(profileName);
  let template;
  try {
    template = await readJson(templatePath);
  } catch (error) {
    if (error instanceof FileSystemError) {
      throw new ProfileError(`Failed to read template: ${error.message}`);
    }
    throw error;
  }

  let variables = {};
  const variablesExist = await hasVariables(profileName);
  if (variablesExist) {
    const variablesPath = getVariablesPath(profileName);
    try {
      variables = await readJson(variablesPath);
    } catch (error) {
      if (error instanceof FileSystemError) {
        throw new ProfileError(`Failed to read variables: ${error.message}`);
      }
      throw error;
    }
  }

  const engine = new TemplateEngine();
  const templateString = JSON.stringify(template);

  let renderedString;
  try {
    renderedString = engine.render(templateString, variables);
  } catch (error) {
    if (error instanceof MissingVariableError) {
      throw new ProfileError(
        `Missing variable: ${error.variableName}. ` +
          `Use 'oos var set ${profileName} ${error.variableName} <value>' to set it.`
      );
    }
    throw error;
  }

  let renderedConfig;
  try {
    renderedConfig = JSON.parse(renderedString);
  } catch {
    throw new ProfileError('Rendered template is not valid JSON');
  }

  const output = JSON.stringify(renderedConfig, null, 2);

  if (options.output) {
    try {
      await fs.writeFile(options.output, output, 'utf8');
      logger.success(`Rendered config written to: ${options.output}`);
    } catch (error) {
      throw new FileSystemError(`Failed to write output file: ${error.message}`);
    }
  } else {
    logger.raw(output);
  }
}

/**
 * Register the render command
 * @param {import('commander').Command} program - Commander program instance
 */
export function registerRenderCommand(program) {
  program
    .command('render <profile-name>')
    .description('Render a profile template with variables and output as JSON')
    .option('-o, --output <file>', 'Write output to file instead of stdout')
    .action(renderAction);
}
