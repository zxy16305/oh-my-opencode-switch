import { ProfileManager } from '../../core/ProfileManager.js';
import { ProfileError } from '../../utils/errors.js';
import { createScreen, createHelpBar } from '../../tui/index.js';
import { VariableList } from '../../tui/components/variable-list.js';
import { ModelSelector } from '../../tui/components/model-selector.js';
import { PreviewPanel, showSuccessMessage } from '../../tui/components/preview-panel.js';
import { readJson, writeJson, exists } from '../../utils/files.js';
import { getVariablesPath, hasTemplate } from '../../utils/paths.js';
import { preloadModels } from '../../tui/model-aggregator.js';
import blessed from 'blessed';

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

  const message = blessed.box({
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
  });
  modelSelector.hide();

  const previewPanel = new PreviewPanel(screen, {
    top: 0,
    left: 0,
    width: '100%',
    height: '100%-1',
  });
  previewPanel.hide();

  const helpBar = createHelpBar(screen, [
    { key: '→/Space', action: 'Edit variable' },
    { key: 'Enter', action: 'Preview changes' },
  ]);

  let variables = [];
  let originalVariables = {};
  let currentView = 'variables';

  if (isTemplate) {
    const variablesPath = getVariablesPath(targetProfile);
    if (await exists(variablesPath)) {
      const loadedVars = await readJson(variablesPath);
      originalVariables = { ...loadedVars };
      variables = Object.entries(loadedVars).map(([name, value]) => ({
        name,
        value: String(value),
      }));
      variableList.setVariables(variables);
    } else {
      variableList.setVariables([]);
    }
  } else {
    variableList.setVariables([
      { name: '(Legacy profile)', value: 'Use template mode for variable editing' },
    ]);
  }

  function showVariableList() {
    currentView = 'variables';
    previewPanel.hide();
    modelSelector.hide();
    variableList.show();
    variableList.focus();
    helpBar.updateShortcuts([
      { key: '→/Space', action: 'Edit variable' },
      { key: 'Enter', action: 'Preview changes' },
      { key: 'Esc', action: 'Exit' },
    ]);
    screen.render();
  }

  function showModelSelector(variable) {
    currentView = 'models';
    previewPanel.hide();
    variableList.hide();
    modelSelector.setVariable(variable.name, variable.value);
    modelSelector.show();
    modelSelector.loadModels(variable.value);
    modelSelector.focus();
    helpBar.updateShortcuts([
      { key: '←/Enter', action: 'Select model' },
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
    showModelSelector(variable);
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
    showVariableList();
  });

  modelSelector.onCancel(() => {
    showVariableList();
  });

  previewPanel.onSave(() => {
    handleSave();
  });

  previewPanel.onCancel(() => {
    showVariableList();
  });

  screen.key(['escape', 'q', 'C-c'], () => {
    if (currentView === 'variables') {
      screen.destroy();
      process.exit(0);
    }
  });

  variableList.focus();
  screen.render();
}

export function registerEditCommand(program) {
  program
    .command('edit [name]')
    .description('Edit profile variables with interactive TUI')
    .action(editAction);
}
