import blessed from 'blessed';

export { getModels, getModelsByProvider, getProviders, hasModel } from './model-aggregator.js';

/**
 * Create the main TUI screen for profile editing
 * @param {object} options - Screen options
 * @returns {object} Blessed screen instance
 */
export function createScreen(options = {}) {
  const screen = blessed.screen({
    smartCSR: true,
    title: options.title || 'OOS Profile Editor',
    fullUnicode: true,
    ...options,
  });

  return screen;
}

/**
 * Create a box component
 * @param {object} screen - Blessed screen instance
 * @param {object} options - Box options
 * @returns {object} Blessed box instance
 */
export function createBox(screen, options = {}) {
  const box = blessed.box({
    parent: screen,
    top: options.top || 'center',
    left: options.left || 'center',
    width: options.width || '50%',
    height: options.height || '50%',
    content: options.content || '',
    tags: true,
    border:
      options.border !== false
        ? {
            type: 'line',
          }
        : undefined,
    style: {
      fg: 'white',
      border: {
        fg: 'cyan',
      },
      ...options.style,
    },
    ...options,
  });

  return box;
}

/**
 * Create a list component
 * @param {object} screen - Blessed screen instance
 * @param {object} options - List options
 * @returns {object} Blessed list instance
 */
export function createList(screen, options = {}) {
  const list = blessed.list({
    parent: screen,
    top: options.top || 0,
    left: options.left || 0,
    width: options.width || '100%',
    height: options.height || '100%',
    items: options.items || [],
    keys: true,
    vi: true,
    mouse: true,
    style: {
      selected: {
        bg: 'blue',
        fg: 'white',
      },
      item: {
        fg: 'white',
      },
      ...options.style,
    },
    border:
      options.border !== false
        ? {
            type: 'line',
          }
        : undefined,
    ...options,
  });

  return list;
}

/**
 * Create a text input component
 * @param {object} screen - Blessed screen instance
 * @param {object} options - Input options
 * @returns {object} Blessed textbox instance
 */
export function createInput(screen, options = {}) {
  const input = blessed.textbox({
    parent: screen,
    top: options.top || 'center',
    left: options.left || 'center',
    width: options.width || '50%',
    height: options.height || 3,
    inputOnFocus: true,
    style: {
      bg: 'black',
      fg: 'white',
      focus: {
        bg: 'blue',
        fg: 'white',
      },
      ...options.style,
    },
    border: {
      type: 'line',
    },
    ...options,
  });

  return input;
}

/**
 * Create a status bar at the bottom of the screen
 * @param {object} screen - Blessed screen instance
 * @param {object} options - Status bar options
 * @returns {object} Blessed box instance
 */
export function createStatusBar(screen, options = {}) {
  const statusBar = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 1,
    content: options.content || ' Press ESC to exit, Tab to navigate',
    tags: true,
    style: {
      bg: 'blue',
      fg: 'white',
      ...options.style,
    },
    ...options,
  });

  return statusBar;
}

/**
 * Create a help bar showing keyboard shortcuts
 * @param {object} screen - Blessed screen instance
 * @param {Array<{key: string, action: string}>} shortcuts - Keyboard shortcuts
 * @returns {object} Blessed box instance
 */
export function createHelpBar(screen, shortcuts = []) {
  const items = shortcuts.map((s) => `{bold}${s.key}{/bold}: ${s.action}`).join('  |  ');

  const statusBar = createStatusBar(screen, { content: ` ${items}` });

  statusBar.updateShortcuts = (newShortcuts) => {
    const newItems = newShortcuts.map((s) => `{bold}${s.key}{/bold}: ${s.action}`).join('  |  ');
    statusBar.setContent(` ${newItems}`);
    screen.render();
  };

  return statusBar;
}
