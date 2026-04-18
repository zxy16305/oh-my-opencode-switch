/**
 * Multi-provider token usage parser.
 * Normalizes token usage from OpenAI and Anthropic response formats.
 */

/**
 * Parse token usage from response body and normalize to consistent structure.
 * @param {object|null} responseBody - API response body
 * @returns {object|null} Normalized token usage or null if unavailable
 */
export function parseTokenUsage(responseBody) {
  if (!responseBody || !responseBody.usage) {
    return null;
  }

  const usage = responseBody.usage;

  const knownFields = [
    'prompt_tokens',
    'input_tokens',
    'completion_tokens',
    'output_tokens',
    'total_tokens',
    'reasoning_tokens',
    'prompt_tokens_details',
    'input_tokens_details',
    'cached_tokens',
    'prompt_cache_hit_tokens',
    'prompt_cache_miss_tokens',
    'cache_creation_input_tokens',
    'cache_read_input_tokens',
  ];

  const usageKeys = Object.keys(usage);
  const hasKnownFields = usageKeys.some((key) => knownFields.includes(key));

  if (usageKeys.length > 0 && !hasKnownFields) {
    return null;
  }

  // Detect provider format and extract values
  // OpenAI uses prompt_tokens/completion_tokens
  // Anthropic uses input_tokens/output_tokens
  const inputTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const outputTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;

  // Cache tokens: providers may report cache hits in several OpenAI-compatible shapes
  const cacheRead =
    usage.prompt_tokens_details?.cached_tokens ??
    usage.input_tokens_details?.cached_tokens ??
    usage.cached_tokens ??
    usage.prompt_cache_hit_tokens ??
    usage.cache_read_input_tokens ??
    0;

  // Cache writes can appear either at top level or nested under prompt_tokens_details
  const cacheWrite =
    usage.cache_creation_input_tokens ??
    usage.prompt_tokens_details?.cache_creation_input_tokens ??
    0;

  // Reasoning tokens (OpenAI specific)
  const reasoningTokens = usage.reasoning_tokens ?? 0;

  // Total: prefer explicit value, otherwise calculate
  const totalTokens = usage.total_tokens ?? (inputTokens + outputTokens);

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read: cacheRead,
    cache_write: cacheWrite,
    reasoning_tokens: reasoningTokens,
    total_tokens: totalTokens,
  };
}

/**
 * Parse compact token string format back to values object.
 * Format: tok=i100/o50/c30/r5/t185 (k/m suffixes for thousands/millions)
 * @param {string|null} tokStr - Compact token string
 * @returns {object|null} Token values object or null if invalid
 */
export function deFormatTokenCompact(tokStr) {
  if (!tokStr || typeof tokStr !== 'string') {
    return null;
  }

  // Must start with 'tok='
  if (!tokStr.startsWith('tok=')) {
    return null;
  }

  const result = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read: 0,
    reasoning_tokens: 0,
    total_tokens: 0,
  };

  // Parse each field: i=input, o=output, c=cache_read, r=reasoning, t=total
  const fields = tokStr.slice(4).split('/');
  const fieldMap = {
    i: 'input_tokens',
    o: 'output_tokens',
    c: 'cache_read',
    r: 'reasoning_tokens',
    t: 'total_tokens',
  };

  for (const field of fields) {
    if (!field) continue;

    const prefix = field[0];
    const valueStr = field.slice(1);

    if (!fieldMap[prefix] || !valueStr) continue;

    const value = parseCompactValue(valueStr);
    if (value !== null) {
      result[fieldMap[prefix]] = value;
    }
  }

  return result;
}

/**
 * Parse compact value string with optional k/m suffix.
 * @param {string} valueStr - Value string (e.g., "100", "1.5k", "2m")
 * @returns {number|null} Parsed value or null if invalid
 */
function parseCompactValue(valueStr) {
  const match = valueStr.match(/^(\d+\.?\d*)([km]?)$/i);
  if (!match) {
    return null;
  }

  const num = parseFloat(match[1]);
  const suffix = match[2].toLowerCase();

  switch (suffix) {
    case 'k':
      return num * 1000;
    case 'm':
      return num * 1000000;
    default:
      return num;
  }
}
