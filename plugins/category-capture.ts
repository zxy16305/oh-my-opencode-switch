import type { Plugin } from '@opencode-ai/plugin';

/**
 * Category Capture Plugin
 *
 * Captures category directly from task() tool calls and injects it via chat.headers hook.
 * This provides a more reliable capture mechanism than inference-based approaches.
 */

// In-memory storage: sessionID -> category
const categoryMap = new Map<string, string>();

export const CategoryCapturePlugin: Plugin = async ({ directory }) => {
  return {
    /**
     * Hook: tool.execute.before
     * Intercepts task() tool calls to capture the category argument.
     */
    'tool.execute.before': async (input, output) => {
      try {
        if (input.tool !== 'task') return;

        let category = output.args?.category;

        if (!category) {
          category = 'default';
        }

        categoryMap.set(input.sessionID, category);
      } catch (error) {
        console.error('[category-capture] Error capturing category:', error);
      }
    },

    /**
     * Hook: chat.headers
     * Injects the captured category as an HTTP header for analytics.
     */
    'chat.headers': async (context) => {
      try {
        const sessionID = context.sessionID || context.sessionId;

        if (!sessionID) {
          console.warn('[category-capture] No sessionID in chat.headers context');
          return context.headers || {};
        }

        let category = categoryMap.get(sessionID);

        if (!category) {
          category = 'default';
        }

        const headers = context.headers || {};
        headers['x-opencode-category'] = category;

        return headers;
      } catch (error) {
        console.error('[category-capture] Error injecting header:', error);
        return context.headers || {};
      }
    },

    /**
     * Hook: session.end
     * Cleans up category map to prevent memory leaks.
     */
    'session.end': async (context) => {
      try {
        const sessionID = context.sessionID || context.sessionId;

        if (sessionID) {
          categoryMap.delete(sessionID);
        }
      } catch (error) {
        console.error('[category-capture] Error cleaning up session:', error);
      }
    },
  };
};

export default CategoryCapturePlugin;
