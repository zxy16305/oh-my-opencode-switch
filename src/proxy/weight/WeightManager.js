// src/proxy/weight/WeightManager.js

import { getTimeSlotType } from '../../utils/time-slot-detector.js';
import {
  calculateErrorRate,
  calculateErrorAdjustment,
  calculateRecovery,
  updateTimeSlotWeight,
} from './algorithms.js';
import { DEFAULT_CONFIG } from './constants.js';

export class WeightManager {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = new Map(); // key: `${routeKey}:${upstreamId}` → UpstreamState
    this.lastTimeSlot = null;
  }

  // === Key 生成 ===
  makeKey(routeKey, upstreamId) {
    return `${routeKey}:${upstreamId}`;
  }

  // === 初始化 ===
  initRoutes(routes) {
    this.lastTimeSlot = getTimeSlotType(new Date().getHours());
    for (const [routeKey, route] of Object.entries(routes)) {
      for (const upstream of route.upstreams) {
        const key = this.makeKey(routeKey, upstream.id);
        const weight = this.getConfiguredWeight(upstream);
        this.state.set(key, this.createInitialState(routeKey, upstream.id, weight));
      }
    }
  }

  createInitialState(routeKey, upstreamId, configuredWeight) {
    return {
      routeKey,
      upstreamId,
      configuredWeight,
      currentWeight: configuredWeight,
      level: 'normal',
      errors: [],
      totalRequests: 0,
      latencies: [],
      avgLatency: 0,
      consecutiveSuccess: 0,
      lastAdjustment: Date.now(),
    };
  }

  getConfiguredWeight(upstream) {
    return upstream.timeSlotWeights?.[this.lastTimeSlot] ?? upstream.weight ?? 100;
  }

  // === 热加载 ===
  reloadConfig(routes) {
    this.lastTimeSlot = getTimeSlotType(new Date().getHours());
    const validKeys = new Set();

    for (const [routeKey, route] of Object.entries(routes)) {
      for (const upstream of route.upstreams) {
        const key = this.makeKey(routeKey, upstream.id);
        validKeys.add(key);
        const newWeight = this.getConfiguredWeight(upstream);

        if (this.state.has(key)) {
          this.updateConfiguredWeight(key, newWeight);
        } else {
          this.state.set(key, this.createInitialState(routeKey, upstream.id, newWeight));
        }
      }
    }

    // 清理已删除的上游
    for (const key of this.state.keys()) {
      if (!validKeys.has(key)) {
        this.state.delete(key);
      }
    }
  }

  // === 时段检查 ===
  checkTimeSlotChange(routes) {
    const currentSlot = getTimeSlotType(new Date().getHours());
    if (currentSlot === this.lastTimeSlot) return false;

    this.lastTimeSlot = currentSlot;
    for (const upstream of this.state.values()) {
      const route = routes[upstream.routeKey];
      const upstreamConfig = route?.upstreams.find((u) => u.id === upstream.upstreamId);
      if (upstreamConfig) {
        const newWeight = this.getConfiguredWeight(upstreamConfig);
        this.updateConfiguredWeight(
          this.makeKey(upstream.routeKey, upstream.upstreamId),
          newWeight
        );
      }
    }
    return true;
  }

  updateConfiguredWeight(key, newWeight) {
    const state = this.state.get(key);
    if (state) {
      updateTimeSlotWeight(state, newWeight);
    }
  }

  // === 请求记录 ===
  recordSuccess(routeKey, upstreamId, latency) {
    const state = this.getState(routeKey, upstreamId);
    if (!state) return;

    state.totalRequests++;
    state.consecutiveSuccess++;
    this.addLatency(state, latency);
    this.pruneOldErrors(state);

    const recovery = calculateRecovery(state, this.config.recoveryThreshold);
    if (recovery) {
      state.currentWeight = recovery.newWeight;
      state.level = recovery.level;
      state.consecutiveSuccess = 0;
      state.lastAdjustment = Date.now();
    }
  }

  recordError(routeKey, upstreamId, errorCode, latency = 0) {
    const state = this.getState(routeKey, upstreamId);
    if (!state) return;

    state.totalRequests++;
    state.consecutiveSuccess = 0;
    state.errors.push({ timestamp: Date.now(), code: errorCode });
    if (latency > 0) this.addLatency(state, latency);
    this.pruneOldErrors(state);

    const adjustment = calculateErrorAdjustment(state, {
      errorWindowMs: this.config.errorWindowMs,
      minWeight: this.config.minWeight,
    });
    if (adjustment) {
      state.currentWeight = adjustment.newWeight;
      state.level = adjustment.level;
      state.lastAdjustment = Date.now();
    }
  }

  // === 获取权重 ===
  getWeight(routeKey, upstreamId) {
    return this.getState(routeKey, upstreamId)?.currentWeight ?? 100;
  }

  getState(routeKey, upstreamId) {
    return this.state.get(this.makeKey(routeKey, upstreamId));
  }

  getAllStates() {
    return this.state;
  }

  // === 内部方法 ===
  addLatency(state, latency) {
    state.latencies.push(latency);
    if (state.latencies.length > this.config.latencyQueueSize) {
      state.latencies.shift();
    }
    state.avgLatency = state.latencies.reduce((a, b) => a + b, 0) / state.latencies.length;
  }

  pruneOldErrors(state) {
    const cutoff = Date.now() - this.config.errorWindowMs;
    state.errors = state.errors.filter((e) => e.timestamp >= cutoff);
  }
}
