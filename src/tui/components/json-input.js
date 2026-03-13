import blessed from 'blessed';

/**
 * Multi-line JSON input component for editing complex non-model variables (object/array)
 */
export class JsonInput {
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
    this.confirmCallback = null;
    this.cancelCallback = null;
    this.errorMessage = null;

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

    this.errorBox = blessed.box({
      parent: this.screen,
      top: 3,
      left: 0,
      width: '100%',
      height: 3,
      tags: true,
      hidden: true,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'red',
        },
      },
    });

    this.inputBox = blessed.textarea({
      parent: this.screen,
      top: 6,
      left: 0,
      width: '100%',
      height: '100%-9',
      keys: true,
      vi: true,
      mouse: true,
      inputOnFocus: true,
      tags: true,
      scrollable: true,
      alwaysScroll: true,
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

    this.helpBox = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      content: ' Ctrl+S: Confirm | Escape: Cancel',
      tags: true,
      style: {
        fg: 'white',
      },
    });

    this.inputBox.key(['C-s'], () => {
      this.handleConfirm();
    });

    this.inputBox.key(['escape'], () => {
      if (this.cancelCallback) {
        this.cancelCallback();
      }
    });
  }

  /**
   * Handle confirm action
   */
  handleConfirm() {
    const input = this.inputBox.getValue();
    try {
      const parsed = JSON.parse(input);
      this.hideError();
      if (this.confirmCallback) {
        this.confirmCallback(parsed);
      }
    } catch (error) {
      this.showError(`Invalid JSON: ${error.message}`);
    }
  }

  /**
   * Show error message
   * @param {string} message - Error message to display
   */
  showError(message) {
    this.errorMessage = message;
    this.errorBox.setContent(` {red-fg}${message}{/red-fg}`);
    this.errorBox.show();
    this.screen.render();
  }

  /**
   * Hide error message
   */
  hideError() {
    this.errorMessage = null;
    this.errorBox.hide();
    this.screen.render();
  }

  /**
   * Set the current variable being edited
   * @param {string} variableName - Name of the variable
   * @param {any} oldValue - Current value of the variable
   */
  setVariable(variableName, oldValue) {
    this.currentVariable = variableName;
    this.oldValue = oldValue;
    this.value = JSON.stringify(oldValue, null, 2);
    this.updateTitle();
    this.hideError();
    this.inputBox.setValue(this.value);
  }

  updateTitle() {
    const type = Array.isArray(this.oldValue) ? 'array' : typeof this.oldValue;
    this.titleBox.setContent(` {bold}Editing: ${this.currentVariable} (${type}){/bold}`);
  }

  /**
   * Register callback for confirm action (Ctrl+S)
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
    this.errorBox.show();
    this.inputBox.show();
    this.helpBox.show();
    this.screen.render();
  }

  /**
   * Hide the component
   */
  hide() {
    this.titleBox.hide();
    this.errorBox.hide();
    this.inputBox.hide();
    this.helpBox.hide();
    this.screen.render();
  }

  /**
   * Destroy the component
   */
  destroy() {
    this.titleBox.destroy();
    this.errorBox.destroy();
    this.inputBox.destroy();
    this.helpBox.destroy();
  }
}
