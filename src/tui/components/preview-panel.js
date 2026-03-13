import blessed from 'blessed';

/**
 * Preview panel component for displaying full JSON and save functionality
 */
export class PreviewPanel {
  /**
   * @param {object} screen - Blessed screen instance
   * @param {object} options - Component options
   */
  constructor(screen, options = {}) {
    this.screen = screen;
    this.options = options;
    this.variables = [];
    this.originalVariables = {};
    this.saveCallback = null;
    this.cancelCallback = null;

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
      content: ' {bold}Preview Changes{/bold}',
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

    // JSON content area (scrollable)
    this.contentBox = blessed.box({
      parent: this.screen,
      top: 3,
      left: 0,
      width: '100%',
      height: '100%-6',
      keys: true,
      vi: true,
      mouse: true,
      scrollable: true,
      alwaysScroll: true,
      tags: true,
      border: {
        type: 'line',
      },
      label: ' variables.json ',
      style: {
        fg: 'white',
        border: {
          fg: 'cyan',
        },
      },
    });

    // Handle Enter key - save
    this.contentBox.key(['enter'], () => {
      if (this.saveCallback) {
        this.saveCallback();
      }
    });

    // Handle Escape key - go back to variable list
    this.contentBox.key(['escape'], () => {
      if (this.cancelCallback) {
        this.cancelCallback();
      }
    });
  }

  /**
   * Set the variables to preview
   * @param {Array<{name: string, value: string}>} variables - Current variables
   * @param {object} originalVariables - Original variables object (before edits)
   */
  setVariables(variables, originalVariables = {}) {
    this.variables = variables || [];
    this.originalVariables = originalVariables;

    // Build variables object for JSON display
    const variablesObj = {};
    for (const v of this.variables) {
      variablesObj[v.name] = v.value;
    }

    // Generate JSON with modification indicators
    const jsonContent = this.formatJsonWithIndicators(variablesObj);

    this.contentBox.setContent(jsonContent);
    this.screen.render();
  }

  /**
   * Format JSON with visual indicators for modified variables
   * @param {object} variablesObj - Variables object
   * @returns {string} Formatted content with tags
   */
  formatJsonWithIndicators(variablesObj) {
    const lines = ['{'];
    const entries = Object.entries(variablesObj);
    const modifiedNames = this.getModifiedVariables(variablesObj);

    for (let i = 0; i < entries.length; i++) {
      const [name, value] = entries[i];
      const isLast = i === entries.length - 1;
      const isModified = modifiedNames.includes(name);

      // Format the value
      let formattedValue;
      if (value === null) {
        formattedValue = 'null';
      } else if (typeof value === 'string') {
        formattedValue = `"${value}"`;
      } else if (typeof value === 'object') {
        formattedValue = JSON.stringify(value);
      } else {
        formattedValue = value;
      }

      // Add modification indicator
      if (isModified) {
        lines.push(
          `  {yellow-fg}*{/yellow-fg} {bold}${name}{/bold}: ${formattedValue}${isLast ? '' : ','}`
        );
      } else {
        lines.push(`    {bold}${name}{/bold}: ${formattedValue}${isLast ? '' : ','}`);
      }
    }

    lines.push('}');

    // Add legend if there are modified variables
    if (modifiedNames.length > 0) {
      lines.push('');
      lines.push('{yellow-fg}*{/yellow-fg} = modified variable');
    }

    return lines.join('\n');
  }

  /**
   * Get list of modified variable names
   * @param {object} currentVariables - Current variables object
   * @returns {Array<string>} Modified variable names
   */
  getModifiedVariables(currentVariables) {
    const modified = [];

    for (const [name, value] of Object.entries(currentVariables)) {
      const originalValue = this.originalVariables[name];
      // Check if variable is new or changed
      if (originalValue === undefined || String(originalValue) !== String(value)) {
        modified.push(name);
      }
    }

    // Check for deleted variables
    for (const name of Object.keys(this.originalVariables)) {
      if (!(name in currentVariables)) {
        modified.push(name);
      }
    }

    return modified;
  }

  /**
   * Register callback for save action (Enter key)
   * @param {function} callback - Callback function()
   */
  onSave(callback) {
    this.saveCallback = callback;
  }

  /**
   * Register callback for cancel/back action (Esc key)
   * @param {function} callback - Callback function()
   */
  onCancel(callback) {
    this.cancelCallback = callback;
  }

  /**
   * Focus this component
   */
  focus() {
    this.contentBox.focus();
  }

  /**
   * Show the component
   */
  show() {
    this.titleBox.show();
    this.contentBox.show();
    this.screen.render();
  }

  /**
   * Hide the component
   */
  hide() {
    this.titleBox.hide();
    this.contentBox.hide();
    this.screen.render();
  }

  /**
   * Destroy the component
   */
  destroy() {
    this.titleBox.destroy();
    this.contentBox.destroy();
  }
}

/**
 * Show a success message overlay
 * @param {object} screen - Blessed screen instance
 * @param {string} message - Success message to display
 * @param {function} onComplete - Callback when message is dismissed
 */
export function showSuccessMessage(screen, message, onComplete) {
  const successBox = blessed.box({
    parent: screen,
    top: 'center',
    left: 'center',
    width: 'shrink',
    height: 'shrink',
    padding: 1,
    content: ` {green-fg}✓{/green-fg} ${message}`,
    tags: true,
    border: {
      type: 'line',
    },
    style: {
      fg: 'white',
      bg: 'green',
      border: {
        fg: 'green',
      },
    },
    align: 'center',
    valign: 'middle',
  });

  screen.render();

  // Auto-dismiss after 1.5 seconds
  setTimeout(() => {
    successBox.destroy();
    screen.render();
    if (onComplete) {
      onComplete();
    }
  }, 1500);
}
