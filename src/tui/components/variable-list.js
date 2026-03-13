import blessed from 'blessed';

/**
 * Variable list component for displaying and selecting template variables
 */
export class VariableList {
  /**
   * @param {object} screen - Blessed screen instance
   * @param {object} options - Component options
   */
  constructor(screen, options = {}) {
    this.screen = screen;
    this.options = options;
    this.variables = [];
    this.selectedCallback = null;

    this.createComponents();
  }

  createComponents() {
    // Title box
    this.titleBox = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      content: ' {bold}Template Variables{/bold}',
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

    // Variable list
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
      label: ' Variables ',
    });

    // Handle selection (Enter key - goes to preview)
    this.list.on('select', (_item, _index) => {
      if (this.previewCallback) {
        this.previewCallback();
      }
    });

    // Handle edit action (→ or Space - goes to model selection for selected variable)
    this.list.key(['right', 'space'], () => {
      if (this.editCallback) {
        const selected = this.list.selected;
        if (this.variables[selected]) {
          this.editCallback(this.variables[selected], selected);
        }
      }
    });
  }

  /**
   * Set the variables to display
   * @param {Array<{name: string, value: string}>} variables - Variables array
   */
  setVariables(variables) {
    this.variables = variables || [];
    const items = this.variables.map((v) => {
      let displayValue;
      if (v.value === null) {
        displayValue = 'null';
      } else if (typeof v.value === 'object') {
        displayValue = JSON.stringify(v.value);
      } else if (typeof v.value === 'string') {
        displayValue = v.value || '(empty)';
      } else {
        displayValue = String(v.value);
      }
      return `{bold}${v.name}{/bold}: ${displayValue}`;
    });
    this.list.setItems(items);
    this.screen.render();
  }

  /**
   * Register callback for variable selection (Enter key)
   * @param {function} callback - Callback function(variable, index)
   */
  onSelect(callback) {
    this.selectedCallback = callback;
  }

  /**
   * Register callback for edit action (→ or Space key)
   * @param {function} callback - Callback function(variable, index)
   */
  onEdit(callback) {
    this.editCallback = callback;
  }

  /**
   * Register callback for preview action (Enter on list)
   * @param {function} callback - Callback function()
   */
  onPreview(callback) {
    this.previewCallback = callback;
  }

  /**
   * Focus this component
   */
  focus() {
    this.list.focus();
  }

  /**
   * Get currently selected variable
   * @returns {object|null} Selected variable or null
   */
  getSelected() {
    const selected = this.list.selected;
    return this.variables[selected] || null;
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
