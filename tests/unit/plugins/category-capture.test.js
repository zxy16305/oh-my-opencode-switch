import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Tests for Category Capture Plugin - Dual Guarantee Mechanism
 *
 * Flow: tool.execute.before (enqueue) → session.created (dequeue) → chat.headers (inject)
 * Verify: tool.execute.after writes verified record + updates cache
 */

const VERIFIED_DIR = path.join(os.homedir(), '.config', 'opencode', '.oos');
const VERIFIED_PATH = path.join(VERIFIED_DIR, 'category-verified.ndjson');

function cleanVerifiedFile() {
  if (fs.existsSync(VERIFIED_PATH)) {
    fs.unlinkSync(VERIFIED_PATH);
  }
}

function readVerifiedRecords() {
  if (!fs.existsSync(VERIFIED_PATH)) return [];
  return fs
    .readFileSync(VERIFIED_PATH, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function getPluginHooks() {
  const { CategoryCapturePlugin } = await import('../../../plugins/category-capture.ts');
  const mockDirectory = { path: '/test' };
  const hooks = await CategoryCapturePlugin({ directory: mockDirectory });
  return hooks;
}

async function callChatHeaders(hooks, inputContext) {
  const output = { headers: { ...inputContext.headers } };
  await hooks['chat.headers'](inputContext, output);
  return output;
}

function simulateSessionCreated(hooks, parentId, childId) {
  return hooks['event']({
    event: {
      type: 'session.created',
      properties: {
        info: {
          id: childId,
          parentID: parentId,
        },
      },
    },
  });
}

describe('Category Capture Plugin - Dual Guarantee', () => {
  let hooks;

  beforeEach(async () => {
    hooks = await getPluginHooks();
    cleanVerifiedFile();
  });

  afterEach(() => {
    cleanVerifiedFile();
  });

  describe('Fast Path: Queue mechanism', () => {
    it('should enqueue category on tool.execute.before', async () => {
      await hooks['tool.execute.before'](
        { tool: 'task', sessionID: 'parent-1', callID: 'call-1' },
        { args: { category: 'quick', subagent_type: 'explore' } }
      );

      const childId = 'child-1';
      await simulateSessionCreated(hooks, 'parent-1', childId);

      const output = await callChatHeaders(hooks, {
        sessionID: childId,
        agent: 'explore',
        headers: {},
      });

      assert.equal(output.headers['x-opencode-category'], 'quick');
      assert.equal(output.headers['x-opencode-agent'], 'explore');
    });

    it('should default category to "default" when not provided', async () => {
      await hooks['tool.execute.before'](
        { tool: 'task', sessionID: 'parent-2', callID: 'call-2' },
        { args: { subagent_type: 'oracle' } }
      );

      await simulateSessionCreated(hooks, 'parent-2', 'child-2');

      const output = await callChatHeaders(hooks, {
        sessionID: 'child-2',
        agent: 'oracle',
        headers: {},
      });

      assert.equal(output.headers['x-opencode-category'], 'default');
      assert.equal(output.headers['x-opencode-agent'], 'oracle');
    });

    it('should handle FIFO queue for multiple task calls from same parent', async () => {
      await hooks['tool.execute.before'](
        { tool: 'task', sessionID: 'parent-multi', callID: 'call-a' },
        { args: { category: 'quick' } }
      );
      await hooks['tool.execute.before'](
        { tool: 'task', sessionID: 'parent-multi', callID: 'call-b' },
        { args: { category: 'deep' } }
      );

      await simulateSessionCreated(hooks, 'parent-multi', 'child-a');
      await simulateSessionCreated(hooks, 'parent-multi', 'child-b');

      const output1 = await callChatHeaders(hooks, {
        sessionID: 'child-a',
        headers: {},
      });
      assert.equal(output1.headers['x-opencode-category'], 'quick');

      const output2 = await callChatHeaders(hooks, {
        sessionID: 'child-b',
        headers: {},
      });
      assert.equal(output2.headers['x-opencode-category'], 'deep');
    });

    it('should ignore session.created for main sessions (no parent)', async () => {
      await hooks['event']({
        event: {
          type: 'session.created',
          properties: {
            info: { id: 'main-session', parentID: null },
          },
        },
      });

      const output = await callChatHeaders(hooks, {
        sessionID: 'main-session',
        headers: {},
      });
      assert.equal(output.headers['x-opencode-category'], 'default');
    });

    it('should ignore non-session.created events', async () => {
      await hooks['tool.execute.before'](
        { tool: 'task', sessionID: 'parent-evt', callID: 'call-evt' },
        { args: { category: 'research' } }
      );

      await hooks['event']({
        event: {
          type: 'message.created',
          properties: {},
        },
      });

      const output = await callChatHeaders(hooks, {
        sessionID: 'child-evt',
        headers: {},
      });
      assert.equal(output.headers['x-opencode-category'], 'default');
    });
  });

  describe('Reliable Path: tool.execute.after verify', () => {
    it('should write verified record on tool.execute.after', async () => {
      await hooks['tool.execute.after'](
        {
          tool: 'task',
          sessionID: 'parent-verify',
          callID: 'call-verify',
          args: { category: 'deep', subagent_type: 'librarian' },
        },
        { metadata: { sessionId: 'child-verify' } }
      );

      const records = readVerifiedRecords();
      assert.equal(records.length, 1);
      assert.equal(records[0].sessionId, 'child-verify');
      assert.equal(records[0].category, 'deep');
      assert.equal(records[0].agent, 'librarian');
      assert.equal(records[0].parentSessionId, 'parent-verify');
    });

    it('should update cache on tool.execute.after', async () => {
      await hooks['tool.execute.after'](
        {
          tool: 'task',
          sessionID: 'parent-cache',
          callID: 'call-cache',
          args: { category: 'visual', subagent_type: 'build' },
        },
        { metadata: { sessionId: 'child-cache' } }
      );

      const output = await callChatHeaders(hooks, {
        sessionID: 'child-cache',
        agent: 'build',
        headers: {},
      });

      assert.equal(output.headers['x-opencode-category'], 'visual');
    });

    it('should correct category if fast path was wrong', async () => {
      await hooks['tool.execute.before'](
        { tool: 'task', sessionID: 'parent-correct', callID: 'call-correct' },
        { args: { category: 'wrong-cat' } }
      );
      await simulateSessionCreated(hooks, 'parent-correct', 'child-correct');

      const beforeOutput = await callChatHeaders(hooks, {
        sessionID: 'child-correct',
        headers: {},
      });
      assert.equal(beforeOutput.headers['x-opencode-category'], 'wrong-cat');

      await hooks['tool.execute.after'](
        {
          tool: 'task',
          sessionID: 'parent-correct',
          callID: 'call-correct',
          args: { category: 'correct-cat', subagent_type: 'oracle' },
        },
        { metadata: { sessionId: 'child-correct' } }
      );

      const afterOutput = await callChatHeaders(hooks, {
        sessionID: 'child-correct',
        headers: {},
      });
      assert.equal(afterOutput.headers['x-opencode-category'], 'correct-cat');
    });

    it('should skip non-task tools', async () => {
      await hooks['tool.execute.after'](
        {
          tool: 'read',
          sessionID: 'parent-skip',
          callID: 'call-skip',
          args: { category: 'skip-cat' },
        },
        { metadata: { sessionId: 'child-skip' } }
      );

      const records = readVerifiedRecords();
      assert.equal(records.length, 0);
    });

    it('should skip when no child sessionId in metadata', async () => {
      await hooks['tool.execute.after'](
        {
          tool: 'task',
          sessionID: 'parent-nometa',
          callID: 'call-nometa',
          args: { category: 'deep' },
        },
        { metadata: {} }
      );

      const records = readVerifiedRecords();
      assert.equal(records.length, 0);
    });
  });

  describe('chat.headers: agent from input.agent', () => {
    it('should use input.agent for agent header', async () => {
      const output = await callChatHeaders(hooks, {
        sessionID: 'any-session',
        agent: 'hephaestus',
        headers: {},
      });

      assert.equal(output.headers['x-opencode-agent'], 'hephaestus');
      assert.equal(output.headers['x-opencode-category'], 'default');
    });

    it('should not set agent header when input.agent is falsy', async () => {
      const output = await callChatHeaders(hooks, {
        sessionID: 'no-agent-session',
        headers: {},
      });

      assert.equal(output.headers['x-opencode-agent'], undefined);
      assert.equal(output.headers['x-opencode-category'], 'default');
    });

    it('should handle sessionId (camelCase) variant', async () => {
      await hooks['tool.execute.after'](
        {
          tool: 'task',
          sessionID: 'p-variant',
          callID: 'c-variant',
          args: { category: 'test' },
        },
        { metadata: { sessionId: 's-variant' } }
      );

      const output = await callChatHeaders(hooks, {
        sessionId: 's-variant',
        agent: 'metis',
        headers: {},
      });

      assert.equal(output.headers['x-opencode-category'], 'test');
      assert.equal(output.headers['x-opencode-agent'], 'metis');
    });
  });

  describe('Full lifecycle integration', () => {
    it('should handle full flow: enqueue → dequeue → headers → verify', async () => {
      const parentId = 'lifecycle-parent';
      const childId = 'lifecycle-child';

      await hooks['tool.execute.before'](
        { tool: 'task', sessionID: parentId, callID: 'lc-1' },
        { args: { category: 'visual', subagent_type: 'build' } }
      );

      await simulateSessionCreated(hooks, parentId, childId);

      const headerOutput = await callChatHeaders(hooks, {
        sessionID: childId,
        agent: 'build',
        headers: { existing: 'value' },
      });
      assert.equal(headerOutput.headers['x-opencode-category'], 'visual');
      assert.equal(headerOutput.headers['x-opencode-agent'], 'build');
      assert.equal(headerOutput.headers['existing'], 'value');

      await hooks['tool.execute.after'](
        {
          tool: 'task',
          sessionID: parentId,
          callID: 'lc-1',
          args: { category: 'visual', subagent_type: 'build' },
        },
        { metadata: { sessionId: childId } }
      );

      const records = readVerifiedRecords();
      assert.equal(records.length, 1);
      assert.equal(records[0].category, 'visual');
      assert.equal(records[0].agent, 'build');
    });

    it('should handle multiple independent sessions', async () => {
      await hooks['tool.execute.before'](
        { tool: 'task', sessionID: 'multi-p1', callID: 'mc-1' },
        { args: { category: 'quick' } }
      );
      await hooks['tool.execute.before'](
        { tool: 'task', sessionID: 'multi-p2', callID: 'mc-2' },
        { args: { category: 'deep' } }
      );

      await simulateSessionCreated(hooks, 'multi-p1', 'multi-c1');
      await simulateSessionCreated(hooks, 'multi-p2', 'multi-c2');

      const out1 = await callChatHeaders(hooks, {
        sessionID: 'multi-c1',
        agent: 'oracle',
        headers: {},
      });
      assert.equal(out1.headers['x-opencode-category'], 'quick');

      const out2 = await callChatHeaders(hooks, {
        sessionID: 'multi-c2',
        agent: 'librarian',
        headers: {},
      });
      assert.equal(out2.headers['x-opencode-category'], 'deep');
    });
  });

  describe('Error handling', () => {
    it('should handle null input in tool.execute.before', async () => {
      await hooks['tool.execute.before'](null, null);
    });

    it('should handle null input in chat.headers', async () => {
      const output = { headers: {} };
      await hooks['chat.headers'](null, output);
      assert.equal(output.headers['x-opencode-category'], 'default');
    });

    it('should handle errors in tool.execute.after gracefully', async () => {
      await hooks['tool.execute.after'](null, { metadata: { sessionId: 'test' } });
    });

    it('should handle empty args in tool.execute.before', async () => {
      await hooks['tool.execute.before'](
        { tool: 'task', sessionID: 'empty-args', callID: 'ea-1' },
        { args: {} }
      );

      await simulateSessionCreated(hooks, 'empty-args', 'child-empty');

      const output = await callChatHeaders(hooks, {
        sessionID: 'child-empty',
        headers: {},
      });
      assert.equal(output.headers['x-opencode-category'], 'default');
    });

    it('should handle undefined args in tool.execute.before', async () => {
      await hooks['tool.execute.before'](
        { tool: 'task', sessionID: 'undef-args', callID: 'ua-1' },
        {}
      );

      await simulateSessionCreated(hooks, 'undef-args', 'child-undef');

      const output = await callChatHeaders(hooks, {
        sessionID: 'child-undef',
        headers: {},
      });
      assert.equal(output.headers['x-opencode-category'], 'default');
    });
  });

  describe('Agent header behavior', () => {
    it('should not set agent header when agent is empty string', async () => {
      const output = await callChatHeaders(hooks, {
        sessionID: 'empty-agent',
        agent: '',
        headers: {},
      });

      assert.equal(output.headers['x-opencode-agent'], undefined);
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
        const output = await callChatHeaders(hooks, {
          sessionID: `agent-test-${agentType}`,
          agent: agentType,
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

  describe('Non-task tool filtering', () => {
    it('should ignore non-task tools in tool.execute.before', async () => {
      await hooks['tool.execute.before'](
        { tool: 'read', sessionID: 'not-task', callID: 'nt-1' },
        { args: { category: 'quick' } }
      );

      const output = await callChatHeaders(hooks, {
        sessionID: 'not-task',
        headers: {},
      });
      assert.equal(output.headers['x-opencode-category'], 'default');
    });

    it('should ignore non-task tools in tool.execute.after', async () => {
      await hooks['tool.execute.after'](
        {
          tool: 'write',
          sessionID: 'not-task-after',
          callID: 'nta-1',
          args: { category: 'quick' },
        },
        { metadata: { sessionId: 'child-nta' } }
      );

      const records = readVerifiedRecords();
      assert.equal(records.length, 0);

      const output = await callChatHeaders(hooks, {
        sessionID: 'child-nta',
        headers: {},
      });
      assert.equal(output.headers['x-opencode-category'], 'default');
    });
  });
});
