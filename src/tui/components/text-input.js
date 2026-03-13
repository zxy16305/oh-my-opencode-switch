import blessed from 'blessed';

/**
 * Text input component for editing simple non-model variables (string/number/boolean)
 */
export class TextInput {
  /**
   * @param {object} screen - Blessed screen instance
   * @param {object} options - Component options
   */
  constructor(screen, options = {}) {
    this.screen = screen;
    this.options = options;
    this.currentVariable = null;
    this.oldValue = null;
    this.value = '';
    this.cursorPos = 0;
    this.confirmCallback = null;
    this.cancelCallback = null;

    this.createComponents();
  }

  createComponents() {
    this.titleBox = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      content: ' {bold}Edit Value{/bold}',
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

    this.inputBox = blessed.textbox({
      parent: this.screen,
      top: 3,
      left: 0,
      width: '100%',
      height: '100%-6',
      keys: true,
      vi: true,
      mouse: true,
      inputOnFocus: true,
      tags: true,
      border: {
        type: 'line',
      },
      label: ' Value ',
      style: {
        fg: 'white',
        border: {
          fg: 'cyan',
        },
        focus: {
          border: {
            fg: 'cyan',
          },
        },
      },
    });

    this.inputBox.key(['enter'], () => {
      if (this.confirmCallback) {
        this.confirmCallback(this.formatValue(this.inputBox.getValue()));
      }
    });

    this.inputBox.key(['escape'], () => {
      if (this.cancelCallback) {
        this.cancelCallback();
      }
    });
  }

  /**
   * Format the input string back to the original type
   * @param {string} input - The input string from textbox
   * @returns {any} Formatted value
   */
  formatValue(input) {
    const originalType = typeof this.oldValue;

    if (this.oldValue === null) {
      if (input.toLowerCase() === 'null') {
        return null;
      }
    }

    switch (originalType) {
      case 'number': {
        const num = Number(input);
        return isNaN(num) ? input : num;
      }
      case 'boolean': {
        const lower = input.toLowerCase();
        if (lower === 'true') return true;
        if (lower === 'false') return false;
        return input;
      }
      case 'string':
      default:
        return input;
    }
  }

  /**
   * Set the current variable being edited
   * @param {string} variableName - Name of the variable
   * @param {any} oldValue - Current value of the variable
   */
  setVariable(variableName, oldValue) {
    this.currentVariable = variableName;
    this.oldValue = oldValue;
    this.value = oldValue === null ? 'null' : String(oldValue);
    this.updateTitle();
    this.inputBox.setValue(this.value);
  }

  updateTitle() {
    const displayValue = this.oldValue === null ? 'null' : this.oldValue;
    this.titleBox.setContent(` {bold}Editing: ${this.currentVariable} = ${displayValue}{/bold}`);
  }

  /**
   * Register callback for confirm action (Enter key)
   * @param {function} callback - Callback function(newValue)
   */
  onConfirm(callback) {
    this.confirmCallback = callback;
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
    this.inputBox.focus();
  }

  /**
   * Show the component
   */
  show() {
    this.titleBox.show();
    this.inputBox.show();
    this.screen.render();
  }

  /**
   * Hide the component
   */
  hide() {
    this.titleBox.hide();
    this.inputBox.hide();
    this.screen.render();
  }

  /**
   * Destroy the component
   */
  destroy() {
    this.titleBox.destroy();
    this.inputBox.destroy();
  }
}
