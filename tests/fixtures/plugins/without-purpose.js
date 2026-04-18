/**
 * Without Purpose Plugin - Test fixture for metadata parsing
 *
 * Behavior:
 * - Stub plugin for testing JSDoc without Purpose field
 * - No actual functionality
 */

export default async function withoutPurposePlugin() {
  return {
    'chat.params': async (_input, _output) => {
      // No-op stub for testing
    },
  };
}