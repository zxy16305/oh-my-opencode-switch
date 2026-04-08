import type { Plugin } from '@opencode-ai/plugin';
import { appendVerifiedRecord } from '../src/utils/category-verified.js';

/**
 * Category Capture Plugin - Dual Guarantee Mechanism
 *
 * Fast Path (Queue): tool.execute.before → Queue → session.created → Cache
 * Reliable Path (Verify): tool.execute.after → Write to verified file + Update cache
 * Agent: Use input.agent directly (100% reliable)
 */

function sanitizeForHeader(value) {
  if (!value) return value;
  return value
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[() ]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

const categoryQueue = new Map<
  string,
  Array<{
    category: string;
    callID: string;
    timestamp: number;
  }>
>();

const childToCategory = new Map<string, string>();

export const CategoryCapturePlugin: Plugin = async ({ directory }) => {
  return {
    'tool.execute.before': async (input, output) => {
      if (!input || !output) return;
      if (input.tool !== 'task') return;

      const parentID = input.sessionID;
      const category = output.args?.category || 'default';
      const callID = input.callID;

      if (!categoryQueue.has(parentID)) {
        categoryQueue.set(parentID, []);
      }
      categoryQueue.get(parentID)!.push({
        category,
        callID,
        timestamp: Date.now(),
      });
    },

    event: async ({ event }) => {
      if (event.type !== 'session.created') return;

      const session = event.properties.info;
      if (!session.parentID) return;

      const queue = categoryQueue.get(session.parentID);
      if (queue?.length) {
        const item = queue.shift()!;
        childToCategory.set(session.id, item.category);

        if (queue.length === 0) {
          categoryQueue.delete(session.parentID);
        }
      }
    },

    'chat.headers': async (input, output) => {
      if (!output) return;

      try {
        const sessionID = input?.sessionID || input?.sessionId;
        const agent = input?.agent;
        const category = sessionID ? childToCategory.get(sessionID) || 'default' : 'default';

        output.headers['x-opencode-category'] = category;
        if (agent) {
          output.headers['x-opencode-agent'] = sanitizeForHeader(agent);
        }
      } catch (error) {
        console.error('[category-capture] Error in chat.headers:', error);
        output.headers['x-opencode-category'] = 'default';
        if (input?.agent) {
          output.headers['x-opencode-agent'] = sanitizeForHeader(input.agent);
        }
      }
    },

    'tool.execute.after': async (input, output) => {
      if (!input || !output) return;
      if (input.tool !== 'task') return;

      const metadata = output.metadata;
      const childSessionId = metadata?.sessionId;
      const correctCategory = input.args?.category || 'default';
      const agent = input.args?.subagent_type;

      if (!childSessionId) return;

      try {
        appendVerifiedRecord({
          sessionId: childSessionId,
          category: correctCategory,
          agent: agent || 'unknown',
          parentSessionId: input.sessionID,
          callID: input.callID,
        });
      } catch (error) {
        console.error('[category-capture] Error writing verified record:', error);
      }

      const previousValue = childToCategory.get(childSessionId);
      childToCategory.set(childSessionId, correctCategory);

      if (previousValue && previousValue !== correctCategory) {
        console.warn(
          `[category-capture] Corrected: ${childSessionId} was "${previousValue}", now "${correctCategory}"`
        );
      }
    },
  };
};

export default CategoryCapturePlugin;
