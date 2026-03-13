import { ProfileManager } from '../../core/ProfileManager.js';
import { ProfileError } from '../../utils/errors.js';
import { createScreen, createHelpBar } from '../../tui/index.js';
import { VariableList } from '../../tui/components/variable-list.js';
import { ModelSelector } from '../../tui/components/model-selector.js';
import { TextInput } from '../../tui/components/text-input.js';
import { JsonInput } from '../../tui/components/json-input.js';
import { PreviewPanel, showSuccessMessage } from '../../tui/components/preview-panel.js';
import { readJson, writeJson, exists } from '../../utils/files.js';
import { getVariablesPath, hasTemplate, getTemplatePath } from '../../utils/paths.js';
import { preloadModels } from '../../tui/model-aggregator.js';
import blessed from 'blessed';

/**
 * Detect which variables in a template correspond to model fields
 * Model variables are those used in:
 * - agents.*.model fields
 * - categories.*.model fields
 *
 * @param {Object} template - The template.json content
 * @returns {Set<string>} Set of variable names that are model variables
 */
function detectModelVariables(template) {
  const modelVariables = new Set();
  const variablePattern = /\{\{\s*([A-Z_][A-Z0-9_]*)\s*\}\}/g;

  /**
   * Recursively traverse an object and find variables used in model fields
   */
  function traverse(obj, path = []) {
    if (!obj || typeof obj !== 'object') {
      return;
    }

    for (const [key, value] of Object.entries(obj)) {
      const currentPath = [...path, key];

      // Check if this field is a model field
      const isModelField =
        currentPath.length >= 2 &&
        currentPath[currentPath.length - 1] === 'model' &&
        (currentPath[0] === 'agents' || currentPath[0] === 'categories');

      if (isModelField && typeof value === 'string') {
        // Extract variables from this model field value
        let match;
        variablePattern.lastIndex = 0;
        while ((match = variablePattern.exec(value)) !== null) {
          modelVariables.add(match[1]);
        }
      }

      // Recurse into nested objects/arrays
      if (typeof value === 'object') {
        traverse(value, currentPath);
      }
    }
  }

  traverse(template);
  return modelVariables;
}

function showApplyConfirm(screen, callback) {
  const confirmBox = blessed.box({
    parent: screen,
    top: 'center',
    left: 'center',
    width: 'shrink',
    height: 'shrink',
    border: { type: 'line' },
    label: ' Apply Profile ',
    tags: true,
    style: {
      fg: 'white',
      border: { fg: 'cyan' },
    },
  });

  blessed.box({
    parent: confirmBox,
    top: 1,
    left: 'center',
    width: 'shrink',
    height: 1,
    content: ' Apply profile now? ',
    tags: true,
  });

  let selected = 0; // 0 = Yes, 1 = No
  const options = ['  Yes  ', '  No  '];

  const optionBox = blessed.box({
    parent: confirmBox,
    top: 3,
    left: 'center',
    width: 'shrink',
    height: 1,
    content: options[selected],
    tags: true,
    style: {
      fg: 'black',
      bg: 'cyan',
    },
  });

  function updateOption() {
    optionBox.setContent(options[selected]);
    screen.render();
  }

  confirmBox.key(['left', 'right'], () => {
    selected = selected === 0 ? 1 : 0;
    updateOption();
  });

  confirmBox.key(['enter'], () => {
    confirmBox.destroy();
    callback(selected === 0);
  });

  confirmBox.key(['escape'], () => {
    confirmBox.destroy();
    callback(false);
  });

  confirmBox.focus();
  screen.render();
}

async function saveVariables(profileName, variables) {
  const variablesPath = getVariablesPath(profileName);
  const variablesObj = {};
  for (const v of variables) {
    variablesObj[v.name] = v.value;
  }
  await writeJson(variablesPath, variablesObj);
}

export async function editAction(profileName, _options) {
  const manager = new ProfileManager();

  let targetProfile = profileName;

  if (!targetProfile) {
    const activeProfile = await manager.getActiveProfile();
    if (!activeProfile) {
      throw new ProfileError('No active profile. Specify a profile name: oos profile edit <name>');
    }
    targetProfile = activeProfile.name;
  }

  await manager.getProfile(targetProfile);

  const isTemplate = await hasTemplate(targetProfile);

  // Detect model variables from template
  let modelVariables = new Set();
  if (isTemplate) {
    const templatePath = getTemplatePath(targetProfile);
    if (await exists(templatePath)) {
      const template = await readJson(templatePath);
      modelVariables = detectModelVariables(template);
    }
  }

  const screen = createScreen({
    title: `OOS Profile Editor - ${targetProfile}`,
  });

  await preloadModels();

  const variableList = new VariableList(screen, {
    top: 0,
    left: 0,
    width: '100%',
    height: '100%-1',
  });

  const modelSelector = new ModelSelector(screen, {
    top: 0,
    left: 0,
    width: '100%',
    height: '100%-1',
    multi: true,
  });
  modelSelector.hide();

  const previewPanel = new PreviewPanel(screen, {
    top: 0,
    left: 0,
    width: '100%',
    height: '100%-1',
  });
  previewPanel.hide();

  const textInput = new TextInput(screen, {
    top: 0,
    left: 0,
    width: '100%',
    height: '100%-1',
  });
  textInput.hide();

  const jsonInput = new JsonInput(screen, {
    top: 0,
    left: 0,
    width: '100%',
    height: '100%-1',
  });
  jsonInput.hide();

  const helpBar = createHelpBar(screen, [
    { key: '→/Space', action: 'Edit variable' },
    { key: 'Enter', action: 'Preview changes' },
  ]);

  let variables = [];
  let originalVariables = {};
  let currentView = 'variables';
  let justReturnedFromSubview = false; // 防止子页面ESC触发全局退出的时序保护

  const variablesPath = getVariablesPath(targetProfile);
  if (await exists(variablesPath)) {
    const loadedVars = await readJson(variablesPath);
    originalVariables = { ...loadedVars };
    variables = Object.entries(loadedVars).map(([name, value]) => ({
      name,
      value,
      isModel: modelVariables.has(name),
    }));
    variableList.setVariables(variables);
  } else {
    variableList.setVariables([]);
  }

  function showVariableList() {
    currentView = 'variables';
    previewPanel.hide();
    modelSelector.hide();
    textInput.hide();
    jsonInput.hide();
    variableList.show();
    variableList.focus();
    helpBar.updateShortcuts([
      { key: '→/Space', action: 'Edit variable' },
      { key: 'Enter', action: 'Preview changes' },
      { key: 'Esc', action: 'Exit' },
    ]);
    screen.render();
  }

  function showJsonInput(variable) {
    currentView = 'json-input';
    previewPanel.hide();
    variableList.hide();
    modelSelector.hide();
    textInput.hide();
    jsonInput.setVariable(variable.name, variable.value);
    jsonInput.show();
    jsonInput.focus();
    helpBar.updateShortcuts([
      { key: 'Ctrl+S', action: 'Confirm' },
      { key: 'Esc', action: 'Cancel' },
    ]);
    screen.render();
  }

  function showModelSelector(variable) {
    currentView = 'models';
    previewPanel.hide();
    variableList.hide();
    textInput.hide();
    modelSelector.setVariable(variable.name, variable.value);
    modelSelector.show();
    modelSelector.loadModels(variable.value);
    modelSelector.focus();
    helpBar.updateShortcuts([
      { key: 'Tab', action: 'Switch panels' },
      { key: 'a', action: 'Add model' },
      { key: 'd', action: 'Delete model' },
      { key: 'k/j', action: 'Move up/down' },
      { key: 'Enter', action: 'Confirm selection' },
      { key: 'Esc', action: 'Cancel' },
    ]);
    screen.render();
  }

  function showTextInput(variable) {
    currentView = 'text-input';
    previewPanel.hide();
    variableList.hide();
    modelSelector.hide();
    textInput.setVariable(variable.name, variable.value);
    textInput.show();
    textInput.focus();
    helpBar.updateShortcuts([
      { key: 'Enter', action: 'Confirm' },
      { key: 'Esc', action: 'Cancel' },
    ]);
    screen.render();
  }

  function showPreviewPanel() {
    currentView = 'preview';
    variableList.hide();
    modelSelector.hide();
    previewPanel.setVariables(variables, originalVariables);
    previewPanel.show();
    previewPanel.focus();
    helpBar.updateShortcuts([
      { key: 'Enter', action: 'Save' },
      { key: 'Esc', action: 'Back' },
    ]);
    screen.render();
  }

  /**
   * Show appropriate input component for non-model variables
   * @param {Object} variable - The variable to edit
   */
  function showNonModelInput(variable) {
    // For complex non-model variables (object/array), use JsonInput
    if (
      Array.isArray(variable.value) ||
      (typeof variable.value === 'object' && variable.value !== null)
    ) {
      showJsonInput(variable);
    } else {
      // For simple non-model variables (string/number/boolean/null), use TextInput
      showTextInput(variable);
    }
  }

  async function handleSave() {
    await saveVariables(targetProfile, variables);

    showApplyConfirm(screen, async (apply) => {
      if (apply) {
        try {
          const manager = new ProfileManager();
          await manager.switchProfile(targetProfile);
          showSuccessMessage(screen, 'Applied successfully!', () => {
            screen.destroy();
            process.exit(0);
          });
        } catch (error) {
          showSuccessMessage(screen, 'Saved! Apply failed: ' + error.message, () => {
            screen.destroy();
            process.exit(0);
          });
        }
      } else {
        showSuccessMessage(screen, 'Saved successfully!', () => {
          screen.destroy();
          process.exit(0);
        });
      }
    });
  }

  variableList.onEdit((variable) => {
    // Detect if this is a model variable using the isModel flag
    if (variable.isModel) {
      // For model variables: open existing ModelSelector
      showModelSelector(variable);
    } else {
      // For non-model variables: open appropriate input component
      showNonModelInput(variable);
    }
  });

  variableList.onPreview(() => {
    showPreviewPanel();
  });

  modelSelector.onSelect((selectedModelId) => {
    const selectedVar = variableList.getSelected();
    if (selectedVar) {
      const idx = variables.findIndex((v) => v.name === selectedVar.name);
      if (idx !== -1) {
        variables[idx].value = selectedModelId;
        variableList.setVariables(variables);
      }
    }
    justReturnedFromSubview = true;
    showVariableList();
  });

  modelSelector.onCancel(() => {
    justReturnedFromSubview = true;
    showVariableList();
  });

  textInput.onConfirm((newValue) => {
    const selectedVar = variableList.getSelected();
    if (selectedVar) {
      const idx = variables.findIndex((v) => v.name === selectedVar.name);
      if (idx !== -1) {
        variables[idx].value = newValue;
        variableList.setVariables(variables);
      }
    }
    justReturnedFromSubview = true;
    showVariableList();
  });

  textInput.onCancel(() => {
    justReturnedFromSubview = true;
    showVariableList();
  });

  jsonInput.onConfirm((newValue) => {
    const selectedVar = variableList.getSelected();
    if (selectedVar) {
      const idx = variables.findIndex((v) => v.name === selectedVar.name);
      if (idx !== -1) {
        variables[idx].value = newValue;
        variableList.setVariables(variables);
      }
    }
    justReturnedFromSubview = true;
    showVariableList();
  });

  jsonInput.onCancel(() => {
    justReturnedFromSubview = true;
    showVariableList();
  });

  previewPanel.onSave(() => {
    handleSave();
  });

  previewPanel.onCancel(() => {
    justReturnedFromSubview = true;
    showVariableList();
  });

  screen.key(['escape', 'q', 'C-c'], () => {
    if (justReturnedFromSubview) {
      justReturnedFromSubview = false;
      return false;
    }
    if (currentView === 'variables') {
      screen.destroy();
      process.exit(0);
    }
    return false;
  });

  variableList.focus();
  screen.render();
}

export function registerEditCommand(program) {
  program
    .command('edit [name]')
    .description(
      'Edit profile variables with interactive TUI. Supports editing both model and non-model variables. Simple values use single-line text input; complex objects/arrays use multi-line JSON input with syntax validation.'
    )
    .action(editAction);
}
