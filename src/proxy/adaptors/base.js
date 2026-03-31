/**
 * Base adaptor - abstract interface for provider request/response translation.
 *
 * Each adaptor handles:
 * - Translating outgoing requests for the upstream provider
 * - Normalizing upstream responses to a canonical format
 * - Resolving API keys from config / environment
 *
 * Subclasses MUST override `translateRequest` and `normalizeResponse`.
 */
export class BaseAdaptor {
  /**
   * @param {object} providerConfig - Upstream / provider configuration
   * @param {string} providerConfig.target  - Base URL of the upstream API
   * @param {string} [providerConfig.apiKey]      - Direct API key value
   * @param {string} [providerConfig.apiKeyEnv]   - Env var name that holds the API key
   * @param {Record<string,string>} [providerConfig.headers] - Extra headers to forward
   * @param {number} [providerConfig.timeout]     - Request timeout in ms
   * @param {number} [providerConfig.retryCount]  - Number of retries on failure
   */
  constructor(providerConfig) {
    if (new.target === BaseAdaptor) {
      throw new Error('BaseAdaptor is abstract and cannot be instantiated directly');
    }
    this.config = providerConfig;
  }

  /**
   * Resolve the API key from config.
   * Priority: `apiKey` (direct value) > `apiKeyEnv` (env var name) > null
   * @returns {string|null}
   */
  resolveApiKey() {
    if (this.config.apiKey) {
      return this.config.apiKey;
    }
    if (this.config.apiKeyEnv) {
      const key = process.env[this.config.apiKeyEnv];
      if (!key) {
        console.warn(`[adaptor] API key env var "${this.config.apiKeyEnv}" is not set`);
      }
      return key ?? null;
    }
    return null;
  }

  /**
   * Translate an incoming request for the upstream provider.
   *
   * @param {object} request
   * @param {string} request.url    - Original request URL (path + query)
   * @param {string} request.method - HTTP method
   * @param {Record<string,string>} request.headers - Incoming headers
   * @param {ReadableStream|Buffer|string|null} request.body - Request body
   * @returns {object} Translated request: { url, method, headers, body }
   */
  translateRequest(_request) {
    throw new Error('translateRequest() must be implemented by subclass');
  }

  /**
   * Normalize an upstream response to the canonical format.
   *
   * @param {object} response
   * @param {number} response.status  - HTTP status code
   * @param {Record<string,string>} response.headers - Response headers
   * @param {any} response.body       - Parsed response body
   * @returns {object} Normalized response: { status, headers, body }
   */
  normalizeResponse(_response) {
    throw new Error('normalizeResponse() must be implemented by subclass');
  }

  /**
   * Determine whether an upstream response is an error.
   * @param {object} response - { status, headers, body }
   * @returns {boolean}
   */
  isErrorResponse(response) {
    return response.status >= 400;
  }

  /**
   * Build a passthrough error response preserving the original status and body.
   * @param {object} response - { status, headers, body }
   * @returns {object} Error response: { status, headers, body }
   */
  buildErrorResponse(response) {
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
    };
  }
}
