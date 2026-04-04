/**
 * Proxy errors module - contains error classes for the proxy system
 * @module proxy/errors
 */

/**
 * Router-specific error class
 * Used for errors related to routing decisions and upstream selection
 */
export class RouterError extends Error {
  /**
   * Create a RouterError
   * @param {string} message - Error message
   * @param {string} code - Error code
   * @param {Object} [details] - Additional details
   */
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'RouterError';
    this.code = code;
    this.details = details;
  }
}
