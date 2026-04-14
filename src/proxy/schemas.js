/**
 * Schema definitions for proxy configuration
 * @module proxy/schemas
 */

import { z } from 'zod';

/**
 * Upstream configuration schema
 */
export const upstreamSchema = z.object({
  id: z.string().min(1, 'Upstream ID is required'),
  provider: z.string().min(1, 'Provider name is required'),
  model: z.string().min(1, 'Model name is required'),
  baseURL: z.string().url('Base URL must be a valid URL'),
  apiKey: z.string().optional(),
  weight: z.number().int().min(0).max(1000).optional().default(100),
  metadata: z.record(z.unknown()).optional(),
  timeSlotWeights: z
    .object({
      high: z.number().min(0).optional(),
      medium: z.number().min(0).optional(),
      low: z.number().min(0).optional(),
    })
    .strict()
    .optional(),
});

/**
 * Route configuration schema
 */
export const routeSchema = z.object({
  strategy: z
    .enum(['round-robin', 'random', 'weighted', 'sticky'])
    .default('sticky')
    .transform(() => 'sticky'), // 静默转为 sticky，向后兼容
  upstreams: z.array(upstreamSchema).min(1, 'At least one upstream is required'),
  metadata: z.record(z.unknown()).optional(),
  stickyReassignThreshold: z.number().int().positive().optional().default(10),
  stickyReassignMinGap: z.number().int().min(0).optional().default(2),
  dynamicWeight: z
    .object({
      enabled: z.boolean().default(true),
      initialWeight: z.number().int().positive().default(100),
      minWeight: z.number().int().min(0).default(10),
      checkInterval: z.number().int().positive().default(10),
      latencyThreshold: z.number().positive().default(1.5),
      latencyWindowMs: z.number().int().positive().default(60000),
      recoveryInterval: z.number().int().positive().default(300000),
      recoveryAmount: z.number().int().positive().default(1),
      errorWeightReduction: z
        .object({
          enabled: z.boolean().default(true),
          errorCodes: z.array(z.number()).default([429, 500, 502, 503, 504]),
          reductionAmount: z.number().int().positive().default(10),
          minWeight: z.number().int().positive().default(5),
          errorWindowMs: z.number().int().positive().default(3600000),
        })
        .optional()
        .default({
          enabled: true,
          errorCodes: [429, 500, 502, 503, 504],
          reductionAmount: 10,
          minWeight: 5,
          errorWindowMs: 3600000,
        }),
    })
    .optional()
    .default({
      enabled: true,
      initialWeight: 100,
      minWeight: 10,
      checkInterval: 10,
      latencyThreshold: 1.5,
      latencyWindowMs: 60000,
      recoveryInterval: 300000,
      recoveryAmount: 1,
      errorWeightReduction: {
        enabled: true,
        errorCodes: [429, 500, 502, 503, 504],
        reductionAmount: 10,
        minWeight: 5,
        errorWindowMs: 3600000,
      },
    }),
  timeSlotWeight: z
    .object({
      enabled: z.boolean().default(true),
      totalErrorThreshold: z.number().positive().default(0.01),
      dangerSlotThreshold: z.number().positive().default(0.05),
      dangerMultiplier: z.number().positive().default(0.5),
      normalMultiplier: z.number().positive().default(2.0),
      lookbackDays: z.number().int().positive().default(7),
    })
    .optional()
    .default({
      enabled: true,
      totalErrorThreshold: 0.01,
      dangerSlotThreshold: 0.05,
      dangerMultiplier: 0.5,
      normalMultiplier: 2.0,
      lookbackDays: 7,
    }),
});

/**
 * Full routes configuration schema
 */
export const routesConfigSchema = z.record(z.string(), routeSchema);

/**
 * @typedef {z.infer<typeof upstreamSchema>} Upstream
 * @typedef {z.infer<typeof routeSchema>} Route
 * @typedef {z.infer<typeof routesConfigSchema>} RoutesConfig
 */
