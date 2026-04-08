import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Tests for Category Capture Plugin
 *
 * NOTE: The plugin uses a module-scoped categoryMap, which means tests share state.
 * We test the hook functions directly and verify behavior.
 *
 * chat.headers hook uses (input, output) two-parameter signature per SDK:
 *   - input: { sessionID, agent, model, provider, message }
 *   - output: { headers: Record<string, string> }
 *   - returns void (modifies output.headers directly)
 */

async function getPluginHooks() {
  const { CategoryCapturePlugin } = await import('../../../plugins/category-capture.ts');
  const mockDirectory = { path: '/test' };
  const hooks = await CategoryCapturePlugin({ directory: mockDirectory });
  return hooks;
}

/**
 * Helper: call chat.headers with correct (input, output) signature
 * Returns the output object so assertions can check output.headers
 */
async function callChatHeaders(hooks, inputContext) {
  const output = { headers: { ...inputContext.headers } };
  await hooks['chat.headers'](inputContext, output);
  return output;
}

describe('Category Capture Plugin', () => {
  let hooks;

  beforeEach(async () => {
    hooks = await getPluginHooks();
  });

  describe('tool.execute.before hook', () => {
    it('should capture both category and agent from task() call', async () => {
      const input = {
        tool: 'task',
        sessionID: 'test-session-1',
      };

      const output = {
        args: {
          category: 'quick',
          subagent_type: 'explore',
        },
      };

      await hooks['tool.execute.before'](input, output);

      const outputObj = await callChatHeaders(hooks, {
        sessionID: 'test-session-1',
        headers: {},
      });

      assert.equal(outputObj.headers['x-opencode-category'], 'quick');
      assert.equal(outputObj.headers['x-opencode-agent'], 'explore');
    });

    it('should default category to "default" when not provided', async () => {
      const input = {
        tool: 'task',
        sessionID: 'test-session-2',
      };

      const output = {
        args: {
          subagent_type: 'oracle',
        },
      };

      await hooks['tool.execute.before'](input, output);

      const outputObj = await callChatHeaders(hooks, {
        sessionID: 'test-session-2',
        headers: {},
      });

      assert.equal(outputObj.headers['x-opencode-category'], 'default');
      assert.equal(outputObj.headers['x-opencode-agent'], 'oracle');
    });

    it('should set agent to null when subagent_type is missing', async () => {
      const input = {
        tool: 'task',
        sessionID: 'test-session-3',
      };

      const output = {
        args: {
          category: 'research',
        },
      };

      await hooks['tool.execute.before'](input, output);

      const outputObj = await callChatHeaders(hooks, {
        sessionID: 'test-session-3',
        headers: {},
      });

      assert.equal(outputObj.headers['x-opencode-category'], 'research');
      assert.equal(
        outputObj.headers['x-opencode-agent'],
        undefined,
        'Agent header should not be set when agent is null'
      );
    });

    it('should not capture for non-task tools', async () => {
      const input = {
        tool: 'other-tool',
        sessionID: 'test-session-4',
      };

      const output = {
        args: {
          category: 'quick',
          subagent_type: 'explore',
        },
      };

      await hooks['tool.execute.before'](input, output);

      const outputObj = await callChatHeaders(hooks, {
        sessionID: 'test-session-4',
        headers: {},
      });

      assert.equal(outputObj.headers['x-opencode-category'], 'default');
      assert.equal(outputObj.headers['x-opencode-agent'], undefined);
    });

    it('should handle empty args object', async () => {
      const input = {
        tool: 'task',
        sessionID: 'test-session-5',
      };

      const output = {
        args: {},
      };

      await hooks['tool.execute.before'](input, output);

      const outputObj = await callChatHeaders(hooks, {
        sessionID: 'test-session-5',
        headers: {},
      });

      assert.equal(outputObj.headers['x-opencode-category'], 'default');
      assert.equal(outputObj.headers['x-opencode-agent'], undefined);
    });

    it('should handle undefined args', async () => {
      const input = {
        tool: 'task',
        sessionID: 'test-session-6',
      };

      const output = {};

      await hooks['tool.execute.before'](input, output);

      const outputObj = await callChatHeaders(hooks, {
        sessionID: 'test-session-6',
        headers: {},
      });

      assert.equal(outputObj.headers['x-opencode-category'], 'default');
      assert.equal(outputObj.headers['x-opencode-agent'], undefined);
    });
  });

  describe('chat.headers hook', () => {
    it('should inject both category and agent headers when agent is truthy', async () => {
      await hooks['tool.execute.before'](
        { tool: 'task', sessionID: 'headers-test-1' },
        { args: { category: 'deep', subagent_type: 'librarian' } }
      );

      const input = {
        sessionID: 'headers-test-1',
        headers: {},
      };

      const output = await callChatHeaders(hooks, input);

      assert.equal(output.headers['x-opencode-category'], 'deep');
      assert.equal(output.headers['x-opencode-agent'], 'librarian');
    });

    it('should only inject category header when agent is null', async () => {
      await hooks['tool.execute.before'](
        { tool: 'task', sessionID: 'headers-test-2' },
        { args: { category: 'quick' } }
      );

      const input = {
        sessionID: 'headers-test-2',
        headers: {},
      };

      const output = await callChatHeaders(hooks, input);

      assert.equal(output.headers['x-opencode-category'], 'quick');
      assert.equal(
        output.headers['x-opencode-agent'],
        undefined,
        'Agent header should not be present when agent is null'
      );
    });

    it('should merge with existing headers', async () => {
      await hooks['tool.execute.before'](
        { tool: 'task', sessionID: 'headers-test-3' },
        { args: { category: 'visual', subagent_type: 'build' } }
      );

      const input = {
        sessionID: 'headers-test-3',
        headers: {
          'existing-header': 'existing-value',
        },
      };

      const output = await callChatHeaders(hooks, input);

      assert.equal(output.headers['existing-header'], 'existing-value');
      assert.equal(output.headers['x-opencode-category'], 'visual');
      assert.equal(output.headers['x-opencode-agent'], 'build');
    });

    it('should handle missing sessionID gracefully', async () => {
      const input = {
        headers: { 'some-header': 'value' },
      };

      const output = await callChatHeaders(hooks, input);

      // When no sessionID, hook returns early - only existing headers remain
      assert.equal(output.headers['some-header'], 'value');
      assert.equal(output.headers['x-opencode-category'], undefined);
    });

    it('should handle sessionId variant (camelCase)', async () => {
      await hooks['tool.execute.before'](
        { tool: 'task', sessionID: 'variant-test' },
        { args: { category: 'test', subagent_type: 'oracle' } }
      );

      const input = {
        sessionId: 'variant-test',
        headers: {},
      };

      const output = await callChatHeaders(hooks, input);

      assert.equal(output.headers['x-opencode-category'], 'test');
      assert.equal(output.headers['x-opencode-agent'], 'oracle');
    });

    it('should default to "default" category for unknown sessions', async () => {
      const input = {
        sessionID: 'unknown-session-id',
        headers: {},
      };

      const output = await callChatHeaders(hooks, input);

      assert.equal(output.headers['x-opencode-category'], 'default');
      assert.equal(output.headers['x-opencode-agent'], undefined);
    });
  });

  describe('Integration scenarios', () => {
    it('should handle full lifecycle: capture -> inject headers', async () => {
      const sessionID = 'full-lifecycle-test';

      await hooks['tool.execute.before'](
        { tool: 'task', sessionID },
        { args: { category: 'visual', subagent_type: 'metis' } }
      );

      const output = await callChatHeaders(hooks, {
        sessionID,
        headers: {},
      });
      assert.equal(output.headers['x-opencode-category'], 'visual');
      assert.equal(output.headers['x-opencode-agent'], 'metis');
    });

    it('should handle multiple sessions independently', async () => {
      await hooks['tool.execute.before'](
        { tool: 'task', sessionID: 'multi-1' },
        { args: { category: 'quick', subagent_type: 'oracle' } }
      );

      await hooks['tool.execute.before'](
        { tool: 'task', sessionID: 'multi-2' },
        { args: { category: 'deep', subagent_type: 'librarian' } }
      );

      const output1 = await callChatHeaders(hooks, {
        sessionID: 'multi-1',
        headers: {},
      });
      assert.equal(output1.headers['x-opencode-category'], 'quick');
      assert.equal(output1.headers['x-opencode-agent'], 'oracle');

      const output2 = await callChatHeaders(hooks, {
        sessionID: 'multi-2',
        headers: {},
      });
      assert.equal(output2.headers['x-opencode-category'], 'deep');
      assert.equal(output2.headers['x-opencode-agent'], 'librarian');
    });

    it('should handle overwriting session data', async () => {
      await hooks['tool.execute.before'](
        { tool: 'task', sessionID: 'overwrite-test' },
        { args: { category: 'quick', subagent_type: 'build' } }
      );

      await hooks['tool.execute.before'](
        { tool: 'task', sessionID: 'overwrite-test' },
        { args: { category: 'deep', subagent_type: 'oracle' } }
      );

      const output = await callChatHeaders(hooks, {
        sessionID: 'overwrite-test',
        headers: {},
      });

      assert.equal(output.headers['x-opencode-category'], 'deep');
      assert.equal(output.headers['x-opencode-agent'], 'oracle');
    });
  });

  describe('Error handling', () => {
    it('should handle errors in tool.execute.before gracefully', async () => {
      await hooks['tool.execute.before'](null, null);
    });

    it('should handle errors in chat.headers gracefully', async () => {
      const output = { headers: {} };
      await hooks['chat.headers'](null, output);
      // Should not throw, output.headers may be empty
    });
  });

  describe('Agent header behavior', () => {
    it('should not set agent header when agent is empty string', async () => {
      await hooks['tool.execute.before'](
        { tool: 'task', sessionID: 'empty-agent' },
        { args: { category: 'test', subagent_type: '' } }
      );

      const output = await callChatHeaders(hooks, {
        sessionID: 'empty-agent',
        headers: {},
      });

      assert.equal(output.headers['x-opencode-category'], 'test');
      assert.equal(
        output.headers['x-opencode-agent'],
        undefined,
        'Empty string agent should not be set as header'
      );
    });

    it('should set agent header for various agent types', async () => {
      const agentTypes = [
        'build',
        'oracle',
        'librarian',
        'explore',
        'metis',
        'momus',
        'hephaestus',
      ];

      for (const agentType of agentTypes) {
        const sessionID = `agent-${agentType}`;

        await hooks['tool.execute.before'](
          { tool: 'task', sessionID },
          { args: { category: 'test', subagent_type: agentType } }
        );

        const output = await callChatHeaders(hooks, {
          sessionID,
          headers: {},
        });

        assert.equal(
          output.headers['x-opencode-agent'],
          agentType,
          `Agent header should be set for ${agentType}`
        );
      }
    });
  });
});
