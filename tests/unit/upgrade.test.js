import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

describe('Upgrade Command', () => {
  describe('Module exports', () => {
    it('upgradeAction exists and is exported', async () => {
      const module = await import('../../src/commands/upgrade.js');
      assert.equal(typeof module.upgradeAction, 'function');
    });

    it('registerUpgradeCommand exists and is exported', async () => {
      const module = await import('../../src/commands/upgrade.js');
      assert.equal(typeof module.registerUpgradeCommand, 'function');
    });
  });

  describe('registerUpgradeCommand', () => {
    it('registers the command', async () => {
      const { registerUpgradeCommand } = await import('../../src/commands/upgrade.js');

      const mockProgram = {
        command: mock.fn(() => mockProgram),
        description: mock.fn(() => mockProgram),
        action: mock.fn(() => mockProgram),
      };

      registerUpgradeCommand(mockProgram);

      assert.equal(mockProgram.command.mock.calls.length, 1);
      assert.equal(mockProgram.command.mock.calls[0].arguments[0], 'upgrade');
      assert.equal(mockProgram.description.mock.calls.length, 1);
      assert.equal(mockProgram.action.mock.calls.length, 1);
    });
  });
});
