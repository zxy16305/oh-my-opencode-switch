/**
 * Config diff utility for comparing proxy configurations.
 * Generates a summary of route changes between old and new configs.
 * @module src/utils/config-diff
 */

/**
 * Compare two proxy configs and return a diff of route changes.
 * @param {object} oldConfig - Previous config with routes
 * @param {object} newConfig - New config with routes
 * @returns {{ added: string[], removed: string[], modified: string[], hasChanges: boolean }}
 */
export function diffProxyConfigs(oldConfig, newConfig) {
  const oldRoutes = oldConfig?.routes || {};
  const newRoutes = newConfig?.routes || {};
  const oldKeys = new Set(Object.keys(oldRoutes));
  const newKeys = new Set(Object.keys(newRoutes));

  const added = [];
  const removed = [];
  const modified = [];

  for (const key of newKeys) {
    if (!oldKeys.has(key)) {
      added.push(key);
    }
  }

  for (const key of oldKeys) {
    if (!newKeys.has(key)) {
      removed.push(key);
    }
  }

  for (const key of newKeys) {
    if (oldKeys.has(key) && isRouteModified(oldRoutes[key], newRoutes[key])) {
      modified.push(key);
    }
  }

  return {
    added,
    removed,
    modified,
    hasChanges: added.length > 0 || removed.length > 0 || modified.length > 0,
  };
}

function isRouteModified(oldRoute, newRoute) {
  if (!oldRoute || !newRoute) return true;

  const oldStrategy = oldRoute.strategy || 'round-robin';
  const newStrategy = newRoute.strategy || 'round-robin';
  if (oldStrategy !== newStrategy) return true;

  const oldUpstreams = oldRoute.upstreams || [];
  const newUpstreams = newRoute.upstreams || [];

  if (oldUpstreams.length !== newUpstreams.length) return true;

  for (let i = 0; i < oldUpstreams.length; i++) {
    const o = oldUpstreams[i];
    const n = newUpstreams[i];
    if (o.provider !== n.provider || o.model !== n.model || o.weight !== n.weight) {
      return true;
    }
  }

  return false;
}
