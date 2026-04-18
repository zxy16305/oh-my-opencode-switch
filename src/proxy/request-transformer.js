/**
 * Transforms Chat Completions API format to Responses API format for GPT-5.
 * @module src/proxy/request-transformer
 */

/**
 * Transform Chat Completions request body to Responses API format.
 *
 * @param {Object} requestBody - Chat Completions API request body
 * @param {string} upstreamModel - Target model to use
 * @returns {string} JSON string of transformed request body
 */
export function transformRequestBody(requestBody, upstreamModel) {
  const result = {};

  // 1. messages → input
  if (requestBody.messages !== undefined) {
    result.input = requestBody.messages;
  }

  // 2. tools: unwrap .function wrapper
  if (requestBody.tools !== undefined) {
    result.tools = requestBody.tools.map((tool) => {
      if (tool.type === 'function' && tool.function) {
        const { function: fn, ...rest } = tool;
        return { ...rest, ...fn };
      }
      return tool;
    });
  }

  // 3. reasoning_effort → reasoning.effort
  if (requestBody.reasoning_effort !== undefined) {
    result.reasoning = { effort: requestBody.reasoning_effort };
  }

  // 4. max_tokens → max_output_tokens
  if (requestBody.max_tokens !== undefined) {
    result.max_output_tokens = requestBody.max_tokens;
  }

  // 5. model replaced with upstreamModel
  result.model = upstreamModel;

  // 6. stream preserved
  if (requestBody.stream !== undefined) {
    result.stream = requestBody.stream;
  }

  // 7. All other fields pass through
  const passthroughKeys = [
    'temperature',
    'top_p',
    'presence_penalty',
    'frequency_penalty',
    'stop',
    'user',
    'n',
    'logprobs',
    'top_logprobs',
    'response_format',
    'seed',
    'logit_bias',
  ];

  for (const key of passthroughKeys) {
    if (requestBody[key] !== undefined) {
      result[key] = requestBody[key];
    }
  }

  return JSON.stringify(result);
}
