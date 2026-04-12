import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

describe('Proxy Reload Command', () => {
  let originalFetch;
  let originalExit;
  let exitCode;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalExit = process.exit;
    exitCode = null;
    process.exit = mock.fn((code) => {
      exitCode = code;
      throw new Error('process.exit(' + code + ')');
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.exit = originalExit;
  });

  describe('Module exports', () => {
    it('reloadAction exists and is exported', async () => {
      const module = await import('../../src/commands/proxy-reload.js');
      assert.equal(typeof module.reloadAction, 'function');
    });

    it('registerProxyReloadCommand exists and is exported', async () => {
      const module = await import('../../src/commands/proxy-reload.js');
      assert.equal(typeof module.registerProxyReloadCommand, 'function');
    });
  });

  describe('registerProxyReloadCommand', () => {
    it('registers the reload command with --host and --port options', async () => {
      const { registerProxyReloadCommand } = await import('../../src/commands/proxy-reload.js');

      const mockReloadCommand = {
        description: mock.fn(() => mockReloadCommand),
        option: mock.fn(() => mockReloadCommand),
        action: mock.fn(() => mockReloadCommand),
      };

      const mockProxyCommand = {
        command: mock.fn(() => mockReloadCommand),
      };

      const mockProgram = {
        commands: [{ name: mock.fn(() => 'proxy') }],
      };
      mockProgram.commands.find = mock.fn(() => mockProxyCommand);

      registerProxyReloadCommand(mockProgram);

      assert.equal(mockProxyCommand.command.mock.calls.length, 1);
      assert.equal(mockProxyCommand.command.mock.calls[0].arguments[0], 'reload');
      assert.equal(mockReloadCommand.description.mock.calls.length, 1);

      const hostOptionCalls = mockReloadCommand.option.mock.calls.filter((call) =>
        call.arguments[0].includes('--host')
      );
      assert.ok(hostOptionCalls.length >= 1, '--host option should be registered');

      const portOptionCalls = mockReloadCommand.option.mock.calls.filter((call) =>
        call.arguments[0].includes('--port')
      );
      assert.ok(portOptionCalls.length >= 1, '--port option should be registered');

      assert.equal(mockReloadCommand.action.mock.calls.length, 1);
    });
  });

  describe('reloadAction - flag parsing', () => {
    it('should use default host (localhost) when not specified', async () => {
      const { reloadAction } = await import('../../src/commands/proxy-reload.js');

      global.fetch = mock.fn(async () => ({
        ok: true,
        json: async () => ({
          success: true,
          diff: { added: ['route1'], removed: [], modified: [] },
        }),
      }));

      try {
        await reloadAction({});
      } catch (_error) {
        /* empty */
      }

      assert.equal(global.fetch.mock.calls.length, 1);
      const url = global.fetch.mock.calls[0].arguments[0];
      assert.ok(url.includes('localhost'), 'URL should contain localhost, got: ' + url);
    });

    it('should use custom host from --host flag', async () => {
      const { reloadAction } = await import('../../src/commands/proxy-reload.js');

      global.fetch = mock.fn(async () => ({
        ok: true,
        json: async () => ({ success: true, diff: { added: [], removed: [], modified: [] } }),
      }));

      try {
        await reloadAction({ host: '192.168.1.100' });
      } catch (_error) {
        /* empty */
      }

      assert.equal(global.fetch.mock.calls.length, 1);
      const url = global.fetch.mock.calls[0].arguments[0];
      assert.ok(url.includes('192.168.1.100'), 'URL should contain custom host');
    });

    it('should use default port (3000) when not specified', async () => {
      const { reloadAction } = await import('../../src/commands/proxy-reload.js');

      global.fetch = mock.fn(async () => ({
        ok: true,
        json: async () => ({ success: true, diff: { added: [], removed: [], modified: [] } }),
      }));

      try {
        await reloadAction({});
      } catch (_error) {
        /* empty */
      }

      assert.equal(global.fetch.mock.calls.length, 1);
      const url = global.fetch.mock.calls[0].arguments[0];
      assert.ok(url.includes(':3000'), 'URL should contain port 3000');
    });

    it('should use custom port from --port flag', async () => {
      const { reloadAction } = await import('../../src/commands/proxy-reload.js');

      global.fetch = mock.fn(async () => ({
        ok: true,
        json: async () => ({ success: true, diff: { added: [], removed: [], modified: [] } }),
      }));

      try {
        await reloadAction({ port: '8080' });
      } catch (_error) {
        /* empty */
      }

      assert.equal(global.fetch.mock.calls.length, 1);
      const url = global.fetch.mock.calls[0].arguments[0];
      assert.ok(url.includes(':8080'), 'URL should contain port 8080');
    });

    it('should use both custom host and port when specified', async () => {
      const { reloadAction } = await import('../../src/commands/proxy-reload.js');

      global.fetch = mock.fn(async () => ({
        ok: true,
        json: async () => ({ success: true, diff: { added: [], removed: [], modified: [] } }),
      }));

      try {
        await reloadAction({ host: '10.0.0.1', port: '9000' });
      } catch (_error) {
        /* empty */
      }

      assert.equal(global.fetch.mock.calls.length, 1);
      const url = global.fetch.mock.calls[0].arguments[0];
      assert.ok(url.includes('10.0.0.1:9000'), 'URL should contain host:port');
    });
  });

  describe('reloadAction - success response', () => {
    it('should display diff and exit with code 0 on successful reload', async () => {
      const { reloadAction } = await import('../../src/commands/proxy-reload.js');

      global.fetch = mock.fn(async () => ({
        ok: true,
        json: async () => ({
          success: true,
          diff: {
            added: ['route-new-1', 'route-new-2'],
            removed: ['route-old'],
            modified: ['route-changed'],
          },
        }),
      }));

      try {
        await reloadAction({});
      } catch (_error) {
        /* empty */
      }

      assert.equal(exitCode, 0, 'Should exit with code 0 on success');
    });

    it('should display added routes in diff', async () => {
      const { reloadAction } = await import('../../src/commands/proxy-reload.js');

      global.fetch = mock.fn(async () => ({
        ok: true,
        json: async () => ({
          success: true,
          diff: { added: ['model-a', 'model-b'], removed: [], modified: [] },
        }),
      }));

      const consoleLogs = [];
      const originalLog = console.log;
      console.log = (...args) => consoleLogs.push(args.join(' '));

      try {
        await reloadAction({});
      } catch (_error) {
        /* empty */
      } finally {
        console.log = originalLog;
      }

      const output = consoleLogs.join('\n');
      assert.ok(
        output.includes('model-a') || output.includes('added'),
        'Output should mention added routes'
      );
    });

    it('should display removed routes in diff', async () => {
      const { reloadAction } = await import('../../src/commands/proxy-reload.js');

      global.fetch = mock.fn(async () => ({
        ok: true,
        json: async () => ({
          success: true,
          diff: { added: [], removed: ['deprecated-model'], modified: [] },
        }),
      }));

      const consoleLogs = [];
      const originalLog = console.log;
      console.log = (...args) => consoleLogs.push(args.join(' '));

      try {
        await reloadAction({});
      } catch (_error) {
        /* empty */
      } finally {
        console.log = originalLog;
      }

      const output = consoleLogs.join('\n');
      assert.ok(
        output.includes('deprecated-model') || output.includes('removed'),
        'Output should mention removed routes'
      );
    });

    it('should display modified routes in diff', async () => {
      const { reloadAction } = await import('../../src/commands/proxy-reload.js');

      global.fetch = mock.fn(async () => ({
        ok: true,
        json: async () => ({
          success: true,
          diff: { added: [], removed: [], modified: ['updated-model'] },
        }),
      }));

      const consoleLogs = [];
      const originalLog = console.log;
      console.log = (...args) => consoleLogs.push(args.join(' '));

      try {
        await reloadAction({});
      } catch (_error) {
        /* empty */
      } finally {
        console.log = originalLog;
      }

      const output = consoleLogs.join('\n');
      assert.ok(
        output.includes('updated-model') || output.includes('modified'),
        'Output should mention modified routes'
      );
    });
  });

  describe('reloadAction - error responses', () => {
    it('should exit with code 1 for invalid config error', async () => {
      const { reloadAction } = await import('../../src/commands/proxy-reload.js');

      global.fetch = mock.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({
          success: false,
          error: 'Invalid configuration',
          code: 'INVALID_CONFIG',
        }),
      }));

      try {
        await reloadAction({});
      } catch (_error) {
        /* empty */
      }

      assert.equal(exitCode, 1, 'Should exit with code 1 for invalid config');
    });

    it('should exit with code 2 for connection failed error', async () => {
      const { reloadAction } = await import('../../src/commands/proxy-reload.js');

      global.fetch = mock.fn(async () => {
        throw new Error('ECONNREFUSED');
      });

      try {
        await reloadAction({});
      } catch (_error) {
        /* empty */
      }

      assert.equal(exitCode, 2, 'Should exit with code 2 for connection failed');
    });

    it('should exit with code 2 for timeout error', async () => {
      const { reloadAction } = await import('../../src/commands/proxy-reload.js');

      global.fetch = mock.fn(async () => {
        throw new Error('ETIMEDOUT');
      });

      try {
        await reloadAction({});
      } catch (_error) {
        /* empty */
      }

      assert.equal(exitCode, 2, 'Should exit with code 2 for timeout');
    });

    it('should exit with code 3 for other errors', async () => {
      const { reloadAction } = await import('../../src/commands/proxy-reload.js');

      global.fetch = mock.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({
          success: false,
          error: 'Internal server error',
          code: 'INTERNAL_ERROR',
        }),
      }));

      try {
        await reloadAction({});
      } catch (_error) {
        /* empty */
      }

      assert.equal(exitCode, 3, 'Should exit with code 3 for other errors');
    });

    it('should exit with code 3 for unexpected response format', async () => {
      const { reloadAction } = await import('../../src/commands/proxy-reload.js');

      global.fetch = mock.fn(async () => ({
        ok: true,
        json: async () => ({ diff: {} }),
      }));

      try {
        await reloadAction({});
      } catch (_error) {
        /* empty */
      }

      assert.equal(exitCode, 3, 'Should exit with code 3 for unexpected response');
    });

    it('should display error message for failed reload', async () => {
      const { reloadAction } = await import('../../src/commands/proxy-reload.js');

      global.fetch = mock.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({
          success: false,
          error: 'Configuration file not found',
          code: 'INVALID_CONFIG',
        }),
      }));

      const consoleLogs = [];
      const originalLog = console.log;
      const originalError = console.error;
      console.log = (...args) => consoleLogs.push(args.join(' '));
      console.error = (...args) => consoleLogs.push(args.join(' '));

      try {
        await reloadAction({});
      } catch (_error) {
        /* empty */
      } finally {
        console.log = originalLog;
        console.error = originalError;
      }

      const output = consoleLogs.join('\n');
      assert.ok(
        output.includes('Configuration file not found') || output.includes('error'),
        'Output should contain error message'
      );
    });
  });

  describe('reloadAction - HTTP request details', () => {
    it('should send POST request to /_internal/reload endpoint', async () => {
      const { reloadAction } = await import('../../src/commands/proxy-reload.js');

      global.fetch = mock.fn(async () => ({
        ok: true,
        json: async () => ({ success: true, diff: { added: [], removed: [], modified: [] } }),
      }));

      try {
        await reloadAction({});
      } catch (_error) {
        /* empty */
      }

      assert.equal(global.fetch.mock.calls.length, 1);
      const [url, options] = global.fetch.mock.calls[0].arguments;

      assert.ok(
        url.includes('/_internal/reload'),
        'URL should contain /_internal/reload, got: ' + url
      );
      assert.equal(options?.method, 'POST', 'Should use POST method');
    });

    it('should include appropriate headers in request', async () => {
      const { reloadAction } = await import('../../src/commands/proxy-reload.js');

      global.fetch = mock.fn(async () => ({
        ok: true,
        json: async () => ({ success: true, diff: { added: [], removed: [], modified: [] } }),
      }));

      try {
        await reloadAction({});
      } catch (_error) {
        /* empty */
      }

      const options = global.fetch.mock.calls[0].arguments[1];
      assert.ok(options?.headers, 'Should include headers');
      assert.equal(
        options.headers['Content-Type'],
        'application/json',
        'Should set Content-Type header'
      );
    });
  });
});
