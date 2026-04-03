import { readJson, writeJson, ensureDir, exists } from './files.js';
import { getProxyTimeSlotsPath, getOosDir } from './paths.js';

/**
 * HourlyErrorTracker - Tracks provider request success/failure by hour
 */
export class HourlyErrorTracker {
  constructor() {
    /** @type {Map<string, Map<string, { success: number, failure: number }>>} */
    this.hourlyData = new Map();
    this.dataFilePath = getProxyTimeSlotsPath();
  }

  /**
   * Generate hour key from timestamp (YYYY-MM-DD-HH format)
   * @param {Date} timestamp
   * @returns {string}
   */
  getHourKey(timestamp) {
    const year = timestamp.getFullYear();
    const month = String(timestamp.getMonth() + 1).padStart(2, '0');
    const day = String(timestamp.getDate()).padStart(2, '0');
    const hour = String(timestamp.getHours()).padStart(2, '0');
    return `${year}-${month}-${day}-${hour}`;
  }

  /**
   * Get or create hour data entry for provider
   * @param {string} provider
   * @param {string} hourKey
   * @returns {{ success: number, failure: number }}
   */
  _getHourEntry(provider, hourKey) {
    let providerMap = this.hourlyData.get(provider);
    if (!providerMap) {
      providerMap = new Map();
      this.hourlyData.set(provider, providerMap);
    }

    let hourEntry = providerMap.get(hourKey);
    if (!hourEntry) {
      hourEntry = { success: 0, failure: 0 };
      providerMap.set(hourKey, hourEntry);
    }

    return hourEntry;
  }

  /**
   * Record a successful request for provider at given timestamp
   * @param {string} provider
   * @param {Date} [timestamp=new Date()]
   */
  recordSuccess(provider, timestamp = new Date()) {
    const hourKey = this.getHourKey(timestamp);
    const entry = this._getHourEntry(provider, hourKey);
    entry.success += 1;
  }

  /**
   * Record a failed request for provider at given timestamp
   * @param {string} provider
   * @param {Date} [timestamp=new Date()]
   */
  recordFailure(provider, timestamp = new Date()) {
    const hourKey = this.getHourKey(timestamp);
    const entry = this._getHourEntry(provider, hourKey);
    entry.failure += 1;
  }

  /**
   * Get hour data for provider
   * @param {string} provider
   * @param {string} hourKey
   * @returns {{ success: number, failure: number } | null}
   */
  getHourData(provider, hourKey) {
    const providerMap = this.hourlyData.get(provider);
    if (!providerMap) return null;
    return providerMap.get(hourKey) || null;
  }

  /**
   * Calculate hourly error rate for last N days at specific hour
   * @param {string} provider
   * @param {number} hourOfDay - 0-23
   * @param {number} days - Number of days to look back (default 7)
   * @returns {{ errorRate: number, totalRequests: number, totalFailures: number, dataDays: number, sufficientData: boolean }}
   */
  calculateHourlyErrorRate(provider, hourOfDay, days = 7) {
    const providerMap = this.hourlyData.get(provider);
    if (!providerMap) {
      return {
        errorRate: 0,
        totalRequests: 0,
        totalFailures: 0,
        dataDays: 0,
        sufficientData: false,
      };
    }

    let totalSuccess = 0;
    let totalFailure = 0;
    let dataDays = 0;
    const now = new Date();

    for (let d = 0; d < days; d++) {
      const date = new Date(now);
      date.setDate(date.getDate() - d);
      const hourKey = this.getHourKey(
        new Date(date.getFullYear(), date.getMonth(), date.getDate(), hourOfDay)
      );

      const hourData = providerMap.get(hourKey);
      if (hourData) {
        totalSuccess += hourData.success;
        totalFailure += hourData.failure;
        if (hourData.success > 0 || hourData.failure > 0) {
          dataDays += 1;
        }
      }
    }

    const totalRequests = totalSuccess + totalFailure;
    const errorRate = totalRequests > 0 ? totalFailure / totalRequests : 0;

    return {
      errorRate,
      totalRequests,
      totalFailures: totalFailure,
      dataDays,
      sufficientData: dataDays >= days,
    };
  }

  /**
   * Get all hourly error rates for a provider (all 24 hours)
   * @param {string} provider
   * @param {number} days - Number of days to look back
   * @returns {Array<{ hour: number, errorRate: number, totalRequests: number, dataDays: number, sufficientData: boolean }>}
   */
  getAllHourlyErrorRates(provider, days = 7) {
    const results = [];
    for (let hour = 0; hour < 24; hour++) {
      const stats = this.calculateHourlyErrorRate(provider, hour, days);
      results.push({
        hour,
        ...stats,
      });
    }
    return results;
  }

  /**
   * Calculate total error rate for provider over last N days
   * @param {string} provider
   * @param {number} days
   * @returns {{ errorRate: number, totalRequests: number, totalFailures: number, sufficientData: boolean }}
   */
  calculateTotalErrorRate(provider, days = 7) {
    const providerMap = this.hourlyData.get(provider);
    if (!providerMap) {
      return {
        errorRate: 0,
        totalRequests: 0,
        totalFailures: 0,
        sufficientData: false,
      };
    }

    let totalSuccess = 0;
    let totalFailure = 0;
    let dataHours = 0;
    const now = new Date();
    const cutoffDate = new Date(now);
    cutoffDate.setDate(cutoffDate.getDate() - days);

    for (const [hourKey, hourData] of providerMap) {
      const [year, month, day] = hourKey.split('-').map(Number);
      const hourDate = new Date(year, month - 1, day);

      if (hourDate >= cutoffDate) {
        totalSuccess += hourData.success;
        totalFailure += hourData.failure;
        if (hourData.success > 0 || hourData.failure > 0) {
          dataHours += 1;
        }
      }
    }

    const totalRequests = totalSuccess + totalFailure;
    const errorRate = totalRequests > 0 ? totalFailure / totalRequests : 0;
    const sufficientData = dataHours >= days * 24 * 0.5;

    return {
      errorRate,
      totalRequests,
      totalFailures: totalFailure,
      sufficientData,
    };
  }

  /**
   * Load persisted data from JSON file
   */
  async load() {
    const fileExists = await exists(this.dataFilePath);
    if (!fileExists) {
      return;
    }

    try {
      const data = await readJson(this.dataFilePath);
      this.hourlyData.clear();

      if (data && data.providers) {
        for (const [provider, hours] of Object.entries(data.providers)) {
          const providerMap = new Map();
          for (const [hourKey, stats] of Object.entries(hours)) {
            providerMap.set(hourKey, {
              success: stats.success || 0,
              failure: stats.failure || 0,
            });
          }
          this.hourlyData.set(provider, providerMap);
        }
      }
    } catch (error) {
      console.error('Failed to load time slots data:', error.message);
    }
  }

  /**
   * Save data to JSON file
   */
  async save() {
    await ensureDir(getOosDir());

    const data = {
      providers: {},
      lastUpdated: new Date().toISOString(),
    };

    for (const [provider, providerMap] of this.hourlyData) {
      data.providers[provider] = {};
      for (const [hourKey, stats] of providerMap) {
        data.providers[provider][hourKey] = {
          success: stats.success,
          failure: stats.failure,
        };
      }
    }

    await writeJson(this.dataFilePath, data);
  }

  /**
   * Clean up old data (older than specified days)
   * @param {number} olderThanDays - Default 30
   */
  cleanup(olderThanDays = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    for (const [provider, providerMap] of this.hourlyData) {
      for (const [hourKey, hourData] of providerMap) {
        const [year, month, day] = hourKey.split('-').map(Number);
        const hourDate = new Date(year, month - 1, day);

        if (hourDate < cutoffDate) {
          providerMap.delete(hourKey);
        }
      }

      if (providerMap.size === 0) {
        this.hourlyData.delete(provider);
      }
    }
  }

  /**
   * Get all providers currently tracked
   * @returns {string[]}
   */
  getProviders() {
    return Array.from(this.hourlyData.keys());
  }

  /**
   * Get all hour keys for a provider
   * @param {string} provider
   * @returns {string[]}
   */
  getProviderHourKeys(provider) {
    const providerMap = this.hourlyData.get(provider);
    if (!providerMap) return [];
    return Array.from(providerMap.keys());
  }

  /**
   * Reset all data
   */
  reset() {
    this.hourlyData.clear();
  }
}

/**
 * Factory function to create HourlyErrorTracker instance
 * @returns {HourlyErrorTracker}
 */
export function createHourlyErrorTracker() {
  return new HourlyErrorTracker();
}

/**
 * Default configuration for TimeSlotWeightCalculator
 */
const DEFAULT_TIME_SLOT_CONFIG = {
  totalErrorThreshold: 0.01,
  dangerSlotThreshold: 0.05,
  dangerMultiplier: 0.5,
  normalMultiplier: 2.0,
};

/**
 * TimeSlotWeightCalculator - Calculates weight multipliers based on hourly error patterns
 *
 * Weight coefficients:
 * - 0.5: Danger zone (high error rate hour when provider has high total error)
 * - 1.0: Neutral (low total error rate or insufficient data)
 * - 2.0: Good zone (low error rate hour when provider has high total error)
 */
export class TimeSlotWeightCalculator {
  /**
   * @param {Object} [options]
   * @param {HourlyErrorTracker} [options.tracker] - HourlyErrorTracker instance
   * @param {Object} [options.config] - Configuration overrides
   */
  constructor(options = {}) {
    this.tracker = options.tracker ?? new HourlyErrorTracker();
    this.config = {
      ...DEFAULT_TIME_SLOT_CONFIG,
      ...(options.config || {}),
    };
  }

  /**
   * Get current hour of day (0-23) in local timezone
   * @returns {number}
   */
  getCurrentHour() {
    return new Date().getHours();
  }

  /**
   * Get time slot weight multiplier for a provider at a given hour
   *
   * Logic:
   * - Total error rate < 1% → return 1.0 (no adjustment)
   * - Total error rate > 1%:
   *   - Hour error rate > 5% → return 0.5 (danger zone, reduce weight)
   *   - Hour error rate ≤ 5% → return 2.0 (good zone, boost weight)
   * - Insufficient data (< 7 days) → return 1.0
   *
   * @param {string} provider - Provider identifier
   * @param {number} [hour] - Hour of day (0-23), defaults to current hour
   * @param {Object} [configOverride] - Override config for this calculation
   * @returns {number} Weight multiplier (0.5, 1.0, or 2.0)
   */
  getTimeSlotWeight(provider, hour, configOverride) {
    const hourOfDay = hour ?? this.getCurrentHour();
    const effectiveConfig = configOverride ? { ...this.config, ...configOverride } : this.config;

    const totalStats = this.tracker.calculateTotalErrorRate(provider, 7);

    if (!totalStats.sufficientData) {
      return 1.0;
    }

    if (totalStats.errorRate < effectiveConfig.totalErrorThreshold) {
      return 1.0;
    }

    const hourlyStats = this.tracker.calculateHourlyErrorRate(provider, hourOfDay, 7);

    if (!hourlyStats.sufficientData) {
      return 1.0;
    }

    if (hourlyStats.errorRate > effectiveConfig.dangerSlotThreshold) {
      return effectiveConfig.dangerMultiplier;
    }

    return effectiveConfig.normalMultiplier;
  }

  /**
   * Get weight multipliers for all 24 hours of a provider
   * @param {string} provider - Provider identifier
   * @param {Object} [configOverride] - Override config for this calculation
   * @returns {Array<{ hour: number, weight: number, errorRate: number, sufficientData: boolean }>}
   */
  getAllHourWeights(provider, configOverride) {
    const weights = [];
    for (let h = 0; h < 24; h++) {
      const hourlyStats = this.tracker.calculateHourlyErrorRate(provider, h, 7);
      const weight = this.getTimeSlotWeight(provider, h, configOverride);
      weights.push({
        hour: h,
        weight,
        errorRate: hourlyStats.errorRate,
        sufficientData: hourlyStats.sufficientData,
      });
    }
    return weights;
  }

  /**
   * Get the underlying tracker instance
   * @returns {HourlyErrorTracker}
   */
  getTracker() {
    return this.tracker;
  }

  /**
   * Update configuration
   * @param {Object} newConfig - Configuration updates
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Get current configuration
   * @returns {Object}
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Load persisted data from tracker
   */
  async load() {
    await this.tracker.load();
  }

  /**
   * Persist tracker data
   */
  async save() {
    await this.tracker.save();
  }

  /**
   * Record success through tracker
   * @param {string} provider
   * @param {Date} [timestamp]
   */
  recordSuccess(provider, timestamp) {
    this.tracker.recordSuccess(provider, timestamp);
  }

  /**
   * Record failure through tracker
   * @param {string} provider
   * @param {Date} [timestamp]
   */
  recordFailure(provider, timestamp) {
    this.tracker.recordFailure(provider, timestamp);
  }
}

/**
 * Factory function to create TimeSlotWeightCalculator instance
 * @param {Object} [options] - Same as TimeSlotWeightCalculator constructor
 * @returns {TimeSlotWeightCalculator}
 */
export function createTimeSlotWeightCalculator(options) {
  return new TimeSlotWeightCalculator(options);
}
