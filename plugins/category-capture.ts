import type { Plugin } from '@opencode-ai/plugin';

/**
 * Category Capture Plugin
 *
 * Captures category directly from task() tool calls and injects it via chat.headers hook.
 * This provides a more reliable capture mechanism than inference-based approaches.
 */

// In-memory storage: sessionID -> {category, agent}
const categoryMap = new Map<string, { category: string; agent: string | null }>();

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

        const agent = output.args?.subagent_type || null;

        categoryMap.set(input.sessionID, { category, agent });
      } catch (error) {
        console.error('[category-capture] Error capturing category:', error);
      }
    },

    /**
     * Hook: chat.headers
     * Injects the captured category as an HTTP header for analytics.
     */
    'chat.headers': async (input, output) => {
      try {
        const sessionID = input.sessionID || input.sessionId;

        if (!sessionID) {
          console.warn('[category-capture] No sessionID in chat.headers context');
          return;
        }

        const entry = categoryMap.get(sessionID);

        output.headers['x-opencode-category'] = entry?.category || 'default';
        if (entry?.agent) {
          output.headers['x-opencode-agent'] = entry.agent;
        }
      } catch (error) {
        console.error('[category-capture] Error injecting header:', error);
      }
    },
  };
};

export default CategoryCapturePlugin;
