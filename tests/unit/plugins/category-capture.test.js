import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Tests for Category Capture Plugin
 *
 * NOTE: The plugin uses a module-scoped categoryMap, which means tests share state.
 * We test the hook functions directly and verify behavior.
 */

async function getPluginHooks() {
  const { CategoryCapturePlugin } = await import('../../../plugins/category-capture.ts');
  const mockDirectory = { path: '/test' };
  const hooks = await CategoryCapturePlugin({ directory: mockDirectory });
  return hooks;
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

      const headersContext = {
        sessionID: 'test-session-1',
        headers: {},
      };

      const resultHeaders = await hooks['chat.headers'](headersContext);

      assert.equal(resultHeaders['x-opencode-category'], 'quick');
      assert.equal(resultHeaders['x-opencode-agent'], 'explore');
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

      const headersContext = {
        sessionID: 'test-session-2',
        headers: {},
      };

      const resultHeaders = await hooks['chat.headers'](headersContext);

      assert.equal(resultHeaders['x-opencode-category'], 'default');
      assert.equal(resultHeaders['x-opencode-agent'], 'oracle');
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

      const headersContext = {
        sessionID: 'test-session-3',
        headers: {},
      };

      const resultHeaders = await hooks['chat.headers'](headersContext);

      assert.equal(resultHeaders['x-opencode-category'], 'research');
      assert.equal(
        resultHeaders['x-opencode-agent'],
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

      const headersContext = {
        sessionID: 'test-session-4',
        headers: {},
      };

      const resultHeaders = await hooks['chat.headers'](headersContext);

      assert.equal(resultHeaders['x-opencode-category'], 'default');
      assert.equal(resultHeaders['x-opencode-agent'], undefined);
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

      const headersContext = {
        sessionID: 'test-session-5',
        headers: {},
      };

      const resultHeaders = await hooks['chat.headers'](headersContext);

      assert.equal(resultHeaders['x-opencode-category'], 'default');
      assert.equal(resultHeaders['x-opencode-agent'], undefined);
    });

    it('should handle undefined args', async () => {
      const input = {
        tool: 'task',
        sessionID: 'test-session-6',
      };

      const output = {};

      await hooks['tool.execute.before'](input, output);

      const headersContext = {
        sessionID: 'test-session-6',
        headers: {},
      };

      const resultHeaders = await hooks['chat.headers'](headersContext);

      assert.equal(resultHeaders['x-opencode-category'], 'default');
      assert.equal(resultHeaders['x-opencode-agent'], undefined);
    });
  });

  describe('chat.headers hook', () => {
    it('should inject both category and agent headers when agent is truthy', async () => {
      await hooks['tool.execute.before'](
        { tool: 'task', sessionID: 'headers-test-1' },
        { args: { category: 'deep', subagent_type: 'librarian' } }
      );

      const context = {
        sessionID: 'headers-test-1',
        headers: {},
      };

      const result = await hooks['chat.headers'](context);

      assert.equal(result['x-opencode-category'], 'deep');
      assert.equal(result['x-opencode-agent'], 'librarian');
    });

    it('should only inject category header when agent is null', async () => {
      await hooks['tool.execute.before'](
        { tool: 'task', sessionID: 'headers-test-2' },
        { args: { category: 'quick' } }
      );

      const context = {
        sessionID: 'headers-test-2',
        headers: {},
      };

      const result = await hooks['chat.headers'](context);

      assert.equal(result['x-opencode-category'], 'quick');
      assert.equal(
        result['x-opencode-agent'],
        undefined,
        'Agent header should not be present when agent is null'
      );
    });

    it('should merge with existing headers', async () => {
      await hooks['tool.execute.before'](
        { tool: 'task', sessionID: 'headers-test-3' },
        { args: { category: 'visual', subagent_type: 'build' } }
      );

      const context = {
        sessionID: 'headers-test-3',
        headers: {
          'existing-header': 'existing-value',
        },
      };

      const result = await hooks['chat.headers'](context);

      assert.equal(result['existing-header'], 'existing-value');
      assert.equal(result['x-opencode-category'], 'visual');
      assert.equal(result['x-opencode-agent'], 'build');
    });

    it('should handle missing sessionID gracefully', async () => {
      const context = {
        headers: { 'some-header': 'value' },
      };

      const result = await hooks['chat.headers'](context);

      assert.deepEqual(result, { 'some-header': 'value' });
    });

    it('should handle sessionId variant (camelCase)', async () => {
      await hooks['tool.execute.before'](
        { tool: 'task', sessionID: 'variant-test' },
        { args: { category: 'test', subagent_type: 'oracle' } }
      );

      const context = {
        sessionId: 'variant-test',
        headers: {},
      };

      const result = await hooks['chat.headers'](context);

      assert.equal(result['x-opencode-category'], 'test');
      assert.equal(result['x-opencode-agent'], 'oracle');
    });

    it('should default to "default" category for unknown sessions', async () => {
      const context = {
        sessionID: 'unknown-session-id',
        headers: {},
      };

      const result = await hooks['chat.headers'](context);

      assert.equal(result['x-opencode-category'], 'default');
      assert.equal(result['x-opencode-agent'], undefined);
    });
  });

  describe('session.end hook', () => {
    it('should clean up session from categoryMap', async () => {
      await hooks['tool.execute.before'](
        { tool: 'task', sessionID: 'cleanup-test-1' },
        { args: { category: 'research', subagent_type: 'explore' } }
      );

      let headers = await hooks['chat.headers']({
        sessionID: 'cleanup-test-1',
        headers: {},
      });
      assert.equal(headers['x-opencode-category'], 'research');

      await hooks['session.end']({ sessionID: 'cleanup-test-1' });

      headers = await hooks['chat.headers']({
        sessionID: 'cleanup-test-1',
        headers: {},
      });
      assert.equal(
        headers['x-opencode-category'],
        'default',
        'Category should default after cleanup'
      );
      assert.equal(
        headers['x-opencode-agent'],
        undefined,
        'Agent should be undefined after cleanup'
      );
    });

    it('should handle sessionId variant in cleanup', async () => {
      await hooks['tool.execute.before'](
        { tool: 'task', sessionID: 'cleanup-test-2' },
        { args: { category: 'quick', subagent_type: 'build' } }
      );

      await hooks['session.end']({ sessionId: 'cleanup-test-2' });

      const headers = await hooks['chat.headers']({
        sessionID: 'cleanup-test-2',
        headers: {},
      });

      assert.equal(headers['x-opencode-category'], 'default');
    });

    it('should handle cleanup of non-existent session', async () => {
      await hooks['session.end']({ sessionID: 'non-existent-session' });
    });

    it('should handle missing sessionID in cleanup', async () => {
      await hooks['session.end']({});
    });
  });

  describe('Integration scenarios', () => {
    it('should handle full lifecycle: capture -> headers -> cleanup', async () => {
      const sessionID = 'full-lifecycle-test';

      await hooks['tool.execute.before'](
        { tool: 'task', sessionID },
        { args: { category: 'visual', subagent_type: 'metis' } }
      );

      const headers = await hooks['chat.headers']({
        sessionID,
        headers: {},
      });
      assert.equal(headers['x-opencode-category'], 'visual');
      assert.equal(headers['x-opencode-agent'], 'metis');

      await hooks['session.end']({ sessionID });

      const afterCleanup = await hooks['chat.headers']({
        sessionID,
        headers: {},
      });
      assert.equal(afterCleanup['x-opencode-category'], 'default');
      assert.equal(afterCleanup['x-opencode-agent'], undefined);
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

      const headers1 = await hooks['chat.headers']({
        sessionID: 'multi-1',
        headers: {},
      });
      assert.equal(headers1['x-opencode-category'], 'quick');
      assert.equal(headers1['x-opencode-agent'], 'oracle');

      const headers2 = await hooks['chat.headers']({
        sessionID: 'multi-2',
        headers: {},
      });
      assert.equal(headers2['x-opencode-category'], 'deep');
      assert.equal(headers2['x-opencode-agent'], 'librarian');

      await hooks['session.end']({ sessionID: 'multi-1' });

      const headers2AfterCleanup = await hooks['chat.headers']({
        sessionID: 'multi-2',
        headers: {},
      });
      assert.equal(headers2AfterCleanup['x-opencode-category'], 'deep');
      assert.equal(headers2AfterCleanup['x-opencode-agent'], 'librarian');
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

      const headers = await hooks['chat.headers']({
        sessionID: 'overwrite-test',
        headers: {},
      });

      assert.equal(headers['x-opencode-category'], 'deep');
      assert.equal(headers['x-opencode-agent'], 'oracle');
    });
  });

  describe('Error handling', () => {
    it('should handle errors in tool.execute.before gracefully', async () => {
      await hooks['tool.execute.before'](null, null);
    });

    it('should handle errors in chat.headers gracefully', async () => {
      const result = await hooks['chat.headers'](null);
      assert.deepEqual(result, {});
    });

    it('should handle errors in session.end gracefully', async () => {
      await hooks['session.end'](null);
    });
  });

  describe('Agent header behavior', () => {
    it('should not set agent header when agent is empty string', async () => {
      await hooks['tool.execute.before'](
        { tool: 'task', sessionID: 'empty-agent' },
        { args: { category: 'test', subagent_type: '' } }
      );

      const headers = await hooks['chat.headers']({
        sessionID: 'empty-agent',
        headers: {},
      });

      assert.equal(headers['x-opencode-category'], 'test');
      assert.equal(
        headers['x-opencode-agent'],
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

        const headers = await hooks['chat.headers']({
          sessionID,
          headers: {},
        });

        assert.equal(
          headers['x-opencode-agent'],
          agentType,
          `Agent header should be set for ${agentType}`
        );
      }
    });
  });
});
