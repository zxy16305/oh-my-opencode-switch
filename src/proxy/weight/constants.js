// src/proxy/weight/constants.js

export const ERROR_THRESHOLDS = [
  { rate: 0.3, multiplier: 0.05, level: 'min' }, // >= 30% error rate
  { rate: 0.15, multiplier: 0.2, level: 'medium' }, // >= 15% error rate
  { rate: 0.05, multiplier: 0.5, level: 'half' }, // >= 5% error rate
];

export const RECOVERY_STEPS = {
  min: { multiplier: 0.2, nextLevel: 'medium' },
  medium: { multiplier: 0.5, nextLevel: 'half' },
  half: { multiplier: 1.0, nextLevel: 'normal' },
};

export const DEFAULT_CONFIG = {
  errorWindowMs: 3600000, // 1 hour error window
  latencyThreshold: 1.5, // latency multiplier threshold
  minWeight: 10, // minimum weight floor
  recoveryThreshold: 5, // consecutive successes for recovery
  latencyQueueSize: 50, // max latency samples
  checkInterval: 10, // seconds between periodic checks
  errorCodes: [429, 500, 502, 503, 504],
};
