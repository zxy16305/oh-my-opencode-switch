/**
 * Proxy authentication middleware module
 * Provides API key extraction and validation for the proxy server
 */

/**
 * 从请求头中提取 API Key
 * 支持两种格式:
 * - Authorization: Bearer <key>
 * - x-api-key: <key>
 * @param {import('http').IncomingMessage} req
 * @returns {string|null}
 */
export function extractApiKey(req) {
  // 1. 尝试从 Authorization header 获取 Bearer token
  const authHeader = req.headers['authorization'];
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) {
      return match[1].trim();
    }
  }

  // 2. 尝试从 x-api-key header 获取
  const apiKeyHeader = req.headers['x-api-key'];
  if (apiKeyHeader) {
    return apiKeyHeader.trim();
  }

  // 3. 返回找到的 key 或 null
  return null;
}

/**
 * 验证 API Key
 * @param {string} apiKey - 请求中的 API Key
 * @param {object} authConfig - auth 配置 { enabled, keys }
 * @returns {{ valid: boolean, error?: string }}
 */
export function authenticate(apiKey, authConfig) {
  // 1. 如果 authConfig 不存在或 enabled 为 false，返回 valid: true
  if (!authConfig || !authConfig.enabled) {
    return { valid: true };
  }

  // 2. 如果没有提供 apiKey，返回 valid: false, error: "Missing API Key"
  if (!apiKey) {
    return { valid: false, error: 'Missing API Key' };
  }

  // 3. 检查 apiKey 是否在 authConfig.keys 中且 enabled 为 true
  const keys = authConfig.keys || [];
  const matchedKey = keys.find((keyEntry) => keyEntry.key === apiKey && keyEntry.enabled);

  // 4. 匹配成功返回 valid: true
  if (matchedKey) {
    return { valid: true };
  }

  // 5. 匹配失败返回 valid: false, error: "Invalid API Key"
  return { valid: false, error: 'Invalid API Key' };
}

/**
 * 创建 OpenAI 兼容的错误响应
 * @param {string} message - 错误消息
 * @returns {{ statusCode: number, body: object }}
 */
export function createAuthErrorResponse(message) {
  return {
    statusCode: 401,
    body: {
      error: {
        message,
        type: 'invalid_request_error',
        code: 401,
      },
    },
  };
}
