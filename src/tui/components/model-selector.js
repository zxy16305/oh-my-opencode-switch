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
    this.multi = options.multi || false;
    this.models = [];
    this.modelIndexMap = [];
    this.selectedModels = [];
    this.selectedCallback = null;
    this.cancelCallback = null;
    this.currentVariable = null;
    this.oldValue = null;
    this.focusedList = null;

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

    if (!this.multi) {
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
    } else {
      this.availableList = blessed.list({
        parent: this.screen,
        top: 3,
        left: 0,
        width: '50%',
        height: '100%-9',
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
          border: {
            fg: 'green',
          },
        },
        border: {
          type: 'line',
        },
        label: ' Available Models ',
      });

      this.selectedList = blessed.list({
        parent: this.screen,
        top: 3,
        left: '50%',
        width: '50%',
        height: '100%-9',
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
          border: {
            fg: 'yellow',
          },
        },
        border: {
          type: 'line',
        },
        label: ' Selected Models (Priority Order) ',
      });

      this.helpBar = blessed.box({
        parent: this.screen,
        bottom: 0,
        left: 0,
        width: '100%',
        height: 3,
        content:
          ' {bold}a: Add | d: Delete | k: Up | j: Down | Enter: Confirm | Esc: Cancel{/bold}',
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

      this.availableList.key(['tab'], () => {
        this.focusSelectedList();
      });

      this.selectedList.key(['tab'], () => {
        this.focusAvailableList();
      });

      this.availableList.key(['a', 'A'], () => {
        this.addSelectedModel();
      });

      this.selectedList.key(['d', 'D', 'delete'], () => {
        this.deleteSelectedModel();
      });

      this.selectedList.key(['k', 'K', 'up'], () => {
        this.moveSelectedModelUp();
      });

      this.selectedList.key(['j', 'J', 'down'], () => {
        this.moveSelectedModelDown();
      });

      this.screen.key(['enter', 'left'], () => {
        if (this.selectedCallback && this.selectedModels.length > 0) {
          const result = this.selectedModels.map((m) => m.fullId);
          this.selectedCallback(result);
        }
      });

      this.screen.key(['escape'], () => {
        if (this.cancelCallback) {
          this.cancelCallback();
        }
      });

      this.focusedList = this.availableList;
    }
  }

  focusAvailableList() {
    if (this.multi) {
      this.availableList.focus();
      this.focusedList = this.availableList;
      this.screen.render();
    }
  }

  focusSelectedList() {
    if (this.multi) {
      this.selectedList.focus();
      this.focusedList = this.selectedList;
      this.screen.render();
    }
  }

  addSelectedModel() {
    if (!this.multi) return;

    const selected = this.availableList.selected;
    const modelIdx = this.modelIndexMap[selected];
    if (modelIdx === undefined || !this.models[modelIdx]) return;

    const model = this.models[modelIdx];
    if (this.selectedModels.some((m) => m.fullId === model.fullId)) return;

    this.selectedModels.push(model);
    this.updateSelectedList();
    this.screen.render();
  }

  deleteSelectedModel() {
    if (!this.multi || this.selectedModels.length <= 1) return;

    const selected = this.selectedList.selected;
    if (selected === undefined || selected >= this.selectedModels.length) return;

    this.selectedModels.splice(selected, 1);
    this.updateSelectedList();
    this.screen.render();
  }

  moveSelectedModelUp() {
    if (!this.multi) return;

    const selected = this.selectedList.selected;
    if (selected === undefined || selected <= 0) return;

    const temp = this.selectedModels[selected];
    this.selectedModels[selected] = this.selectedModels[selected - 1];
    this.selectedModels[selected - 1] = temp;

    this.updateSelectedList();
    this.selectedList.select(selected - 1);
    this.screen.render();
  }

  moveSelectedModelDown() {
    if (!this.multi) return;

    const selected = this.selectedList.selected;
    if (selected === undefined || selected >= this.selectedModels.length - 1) return;

    const temp = this.selectedModels[selected];
    this.selectedModels[selected] = this.selectedModels[selected + 1];
    this.selectedModels[selected + 1] = temp;

    this.updateSelectedList();
    this.selectedList.select(selected + 1);
    this.screen.render();
  }

  updateSelectedList() {
    if (!this.multi) return;

    const items = this.selectedModels.map((model, index) => {
      return `${index + 1}. ${model.fullId}`;
    });

    this.selectedList.setItems(items);
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
   * @param {string|Array<string>} [currentValue] - Currently selected model ID(s)
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
        const sourceIndicator = this.getSourceIndicator(model.source);
        items.push(`  ${model.fullId} ${sourceIndicator}`);
        this.modelIndexMap.push(modelIdx);
        modelIdx++;
      }

      if (!this.multi) {
        this.list.setItems(items);

        if (currentValue) {
          const matchIdx = this.models.findIndex((m) => m.fullId === currentValue);
          if (matchIdx !== -1) {
            for (let i = 0; i < this.modelIndexMap.length; i++) {
              if (this.modelIndexMap[i] === matchIdx) {
                this.list.select(i);
                break;
              }
            }
          }
        }
      } else {
        this.availableList.setItems(items);

        this.selectedModels = [];
        if (Array.isArray(currentValue) && currentValue.length > 0) {
          for (const modelId of currentValue) {
            const model = this.models.find((m) => m.fullId === modelId);
            if (model) {
              this.selectedModels.push(model);
            }
          }
        } else if (typeof currentValue === 'string' && currentValue.trim()) {
          const model = this.models.find((m) => m.fullId === currentValue);
          if (model) {
            this.selectedModels.push(model);
          }
        }

        if (this.selectedModels.length === 0 && this.models.length > 0) {
          this.selectedModels.push(this.models[0]);
        }

        this.updateSelectedList();
      }

      this.screen.render();
    } catch (error) {
      const errorItems = ['{red-fg}Error loading models{/red-fg}', error.message];
      if (!this.multi) {
        this.list.setItems(errorItems);
      } else {
        this.availableList.setItems(errorItems);
      }
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
   * @param {function} callback - Callback function(selectedModelId|Array<string>)
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
    if (!this.multi) {
      this.list.focus();
    } else {
      if (this.focusedList) {
        this.focusedList.focus();
      } else {
        this.availableList.focus();
      }
    }
  }

  /**
   * Get currently selected model(s)
   * @returns {object|null|Array<object>} Selected model(s)
   */
  getSelected() {
    if (!this.multi) {
      const selected = this.list.selected;
      const modelIdx = this.modelIndexMap[selected];
      return this.models[modelIdx] || null;
    } else {
      return [...this.selectedModels];
    }
  }

  /**
   * Show the component
   */
  show() {
    this.titleBox.show();
    if (!this.multi) {
      this.list.show();
    } else {
      this.availableList.show();
      this.selectedList.show();
      this.helpBar.show();
    }
    this.screen.render();
  }

  /**
   * Hide the component
   */
  hide() {
    this.titleBox.hide();
    if (!this.multi) {
      this.list.hide();
    } else {
      this.availableList.hide();
      this.selectedList.hide();
      this.helpBar.hide();
    }
    this.screen.render();
  }

  /**
   * Destroy the component
   */
  destroy() {
    this.titleBox.destroy();
    if (!this.multi) {
      this.list.destroy();
    } else {
      this.availableList.destroy();
      this.selectedList.destroy();
      this.helpBar.destroy();
    }
  }
}
