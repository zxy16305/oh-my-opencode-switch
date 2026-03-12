import blessed from 'blessed';
import { getModels } from '../model-aggregator.js';

/**
 * Model selector component for selecting a model for a variable
 */
export class ModelSelector {
  /**
   * @param {object} screen - Blessed screen instance
   * @param {object} options - Component options
   */
  constructor(screen, options = {}) {
    this.screen = screen;
    this.options = options;
    this.models = [];
    this.modelIndexMap = [];
    this.selectedCallback = null;
    this.cancelCallback = null;
    this.currentVariable = null;
    this.oldValue = null;

    this.createComponents();
  }

  createComponents() {
    this.titleBox = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      content: ' {bold}Select Model{/bold}',
      tags: true,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'cyan',
        },
      },
    });

    this.list = blessed.list({
      parent: this.screen,
      top: 3,
      left: 0,
      width: '100%',
      height: '100%-6',
      keys: true,
      vi: true,
      mouse: true,
      tags: true,
      style: {
        selected: {
          bg: 'blue',
          fg: 'white',
          bold: true,
        },
        item: {
          fg: 'white',
        },
      },
      border: {
        type: 'line',
      },
      label: ' Models ',
    });

    this.list.key(['left', 'enter'], () => {
      if (this.selectedCallback) {
        const selected = this.list.selected;
        const modelIdx = this.modelIndexMap[selected];
        if (modelIdx !== undefined && this.models[modelIdx]) {
          const model = this.models[modelIdx];
          this.selectedCallback(model.fullId);
        }
      }
    });

    this.list.key(['escape'], () => {
      if (this.cancelCallback) {
        this.cancelCallback();
      }
    });
  }

  /**
   * Set the current variable being edited
   * @param {string} variableName - Name of the variable
   * @param {string} oldValue - Current value of the variable
   */
  setVariable(variableName, oldValue) {
    this.currentVariable = variableName;
    this.oldValue = oldValue;
    this.updateTitle();
  }

  updateTitle() {
    const displayValue = this.oldValue || '(empty)';
    this.titleBox.setContent(` {bold}Editing: ${this.currentVariable} = ${displayValue}{/bold}`);
  }

  /**
   * Load models from aggregator and populate the list
   * @param {string} [currentValue] - Currently selected model ID
   */
  async loadModels(currentValue) {
    try {
      const providerModels = await getModels();
      this.models = [];
      this.modelIndexMap = [];

      for (const item of providerModels) {
        for (const model of item.models) {
          this.models.push({
            fullId: model,
            provider: item.provider,
            source: item.source,
          });
        }
      }

      const items = [];
      let lastProvider = null;
      let modelIdx = 0;

      for (const model of this.models) {
        if (model.provider !== lastProvider) {
          items.push(`{bold}[${model.provider}]{/bold}`);
          this.modelIndexMap.push(-1);
          lastProvider = model.provider;
        }
        const sourceIndicator = '';
        items.push(`  ${model.fullId} ${sourceIndicator}`);
        this.modelIndexMap.push(modelIdx);
        modelIdx++;
      }

      this.list.setItems(items);

      // Set initial selection to matching model if value exists
      if (currentValue) {
        const matchIdx = this.models.findIndex((m) => m.fullId === currentValue);
        if (matchIdx !== -1) {
          // Find the list index that maps to this model
          for (let i = 0; i < this.modelIndexMap.length; i++) {
            if (this.modelIndexMap[i] === matchIdx) {
              this.list.select(i);
              break;
            }
          }
        }
      }

      this.screen.render();
    } catch (error) {
      this.list.setItems(['{red-fg}Error loading models{/red-fg}', error.message]);
      this.screen.render();
    }
  }

  /**
   * Get a visual indicator for the model source
   * @param {string} source - Model source
   * @returns {string} Source indicator
   */
  getSourceIndicator(source) {
    switch (source) {
      case 'models':
        return '{yellow-fg}[official]{/yellow-fg}';
      default:
        return '';
    }
  }

  /**
   * Register callback for model selection (← or Enter key)
   * @param {function} callback - Callback function(selectedModelId)
   */
  onSelect(callback) {
    this.selectedCallback = callback;
  }

  /**
   * Register callback for cancel action (Esc key)
   * @param {function} callback - Callback function()
   */
  onCancel(callback) {
    this.cancelCallback = callback;
  }

  /**
   * Focus this component
   */
  focus() {
    this.list.focus();
  }

  /**
   * Get currently selected model
   * @returns {object|null} Selected model or null
   */
  getSelected() {
    const selected = this.list.selected;
    return this.models[selected] || null;
  }

  /**
   * Show the component
   */
  show() {
    this.titleBox.show();
    this.list.show();
    this.screen.render();
  }

  /**
   * Hide the component
   */
  hide() {
    this.titleBox.hide();
    this.list.hide();
    this.screen.render();
  }

  /**
   * Destroy the component
   */
  destroy() {
    this.titleBox.destroy();
    this.list.destroy();
  }
}
