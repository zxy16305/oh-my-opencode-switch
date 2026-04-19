/**
 * Protocol detector for determining API protocol from request URL path.
 * @module proxy/protocol-detector
 */

/**
 * Detect protocol from request URL path.
 * /v1/responses or /responses → responses protocol
 * All other paths → chat protocol
 *
 * @param {object} req - HTTP request object with url property
 * @returns {{ protocol: 'chat' | 'responses', endpointPath: string }}
 */
export function detectProtocol(req) {
  // Graceful fallback for missing/invalid request
  if (!req || typeof req.url !== 'string') {
    return { protocol: 'chat', endpointPath: '/chat/completions' };
  }

  const url = req.url;

  // Extract path without query string
  const pathEnd = url.indexOf('?');
  const path = pathEnd === -1 ? url : url.slice(0, pathEnd);

  // Check for responses protocol
  if (path === '/v1/responses' || path === '/responses') {
    return { protocol: 'responses', endpointPath: '/responses' };
  }

  // Default to chat protocol
  return { protocol: 'chat', endpointPath: '/chat/completions' };
}
