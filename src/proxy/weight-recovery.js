import { startWeightRecovery, stopWeightRecovery } from './router.js';
import { createTimeSlotWeightCalculator } from '../utils/time-slot-stats.js';
import { logger } from '../utils/logger.js';

const timeSlotCalculator = createTimeSlotWeightCalculator();

export { timeSlotCalculator };

export function startWeightRecoveryTimers(routes, routeRecoveryTimers, config) {
  for (const [routeKey, route] of Object.entries(routes)) {
    const recoveryTimer = startWeightRecovery(routeKey, route.upstreams, route.dynamicWeight);
    if (recoveryTimer) {
      routeRecoveryTimers.set(routeKey, recoveryTimer);
    }
  }

  let timeSlotSaveTimer = null;
  if (config.timeSlotWeight?.enabled) {
    const HOUR_MS = 60 * 60 * 1000;
    timeSlotSaveTimer = setInterval(async () => {
      await timeSlotCalculator.save().catch((err) => {
        logger.error(`Failed to persist time slot data: ${err.message}`);
      });
    }, HOUR_MS);
  }

  return { timeSlotSaveTimer };
}

export async function initTimeSlotCalculator(config) {
  if (config.timeSlotWeight?.enabled) {
    await timeSlotCalculator.load();
  }
}

export async function stopWeightRecoveryTimers(
  periodicWeightAdjustTimer,
  timeSlotSaveTimer,
  routeRecoveryTimers
) {
  if (periodicWeightAdjustTimer) {
    clearInterval(periodicWeightAdjustTimer);
  }

  if (timeSlotSaveTimer) {
    clearInterval(timeSlotSaveTimer);
    await timeSlotCalculator.save().catch((err) => {
      logger.error(`Failed to persist time slot data on shutdown: ${err.message}`);
    });
  }

  for (const [routeKey] of routeRecoveryTimers) {
    stopWeightRecovery(routeKey);
  }
  routeRecoveryTimers.clear();
}
