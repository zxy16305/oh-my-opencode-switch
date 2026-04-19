/**
 * Endpoint resolver for determining request routing
 * @module proxy/endpoint-resolver
 */

const GPT5_REGEX = /^gpt-5(?:$|\.)/;
const CODEX_REGEX = /codex/i;

/**
 * Resolve the endpoint path for a model request.
 * GPT-5 models with tools or reasoning params go to /responses.
 * All other requests go to /chat/completions.
 *
 * @param {string} model - Model name from the request
 * @param {object} requestBody - Parsed request body
 * @returns {{ endpointPath: string, needsTransform: boolean }}
 */
export function resolveEndpoint(model, requestBody) {
  if (!model || typeof model !== 'string') {
    return { endpointPath: '/chat/completions', needsTransform: false };
  }

  if (!GPT5_REGEX.test(model)) {
    return { endpointPath: '/chat/completions', needsTransform: false };
  }

  // Codex variants may not support the /responses transform chain consistently
  // across proxy providers, keep them on chat/completions for compatibility.
  if (CODEX_REGEX.test(model)) {
    return { endpointPath: '/chat/completions', needsTransform: false };
  }

  if (!requestBody || typeof requestBody !== 'object') {
    return { endpointPath: '/chat/completions', needsTransform: false };
  }

  const hasTools = Array.isArray(requestBody.tools) && requestBody.tools.length > 0;
  const hasReasoningEffort = requestBody.reasoning_effort !== undefined;
  const hasReasoning = requestBody.reasoning !== undefined;

  if (hasTools || hasReasoningEffort || hasReasoning) {
    return { endpointPath: '/responses', needsTransform: true };
  }

  return { endpointPath: '/chat/completions', needsTransform: false };
}
