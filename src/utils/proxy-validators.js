import { z } from 'zod';

export const upstreamSchema = z.object({
  id: z.string().min(1, 'Upstream ID is required').optional(),
  provider: z.string().min(1, 'Provider name is required'),
  model: z.string().min(1, 'Model name is required'),
  baseURL: z.string().url('Base URL must be a valid URL').optional(),
  apiKey: z.string().optional().nullable(),
  weight: z.number().int().min(0).optional(),
  timeSlotWeights: z
    .object({
      high: z.number().min(0).optional(),
      medium: z.number().min(0).optional(),
      low: z.number().min(0).optional(),
    })
    .strict()
    .optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const routeSchema = z.object({
  strategy: z.enum(['round-robin', 'random', 'weighted', 'sticky']).default('round-robin'),
  upstreams: z.array(upstreamSchema).min(1, 'At least one upstream is required'),
  metadata: z.record(z.unknown()).optional(),
  dynamicWeight: z
    .object({
      enabled: z.boolean().default(true),
      initialWeight: z.number().int().positive().default(100),
      minWeight: z.number().int().min(0).default(10),
      checkInterval: z.number().int().positive().default(10),
      latencyThreshold: z.number().positive().default(1.5),
      recoveryInterval: z.number().int().positive().default(300000),
      recoveryAmount: z.number().int().positive().default(1),
    })
    .optional(),
  timeSlotWeight: z
    .object({
      enabled: z.boolean().default(true),
      totalErrorThreshold: z.number().positive().default(0.01),
      dangerSlotThreshold: z.number().positive().default(0.05),
      dangerMultiplier: z.number().positive().default(0.5),
      normalMultiplier: z.number().positive().default(2.0),
      lookbackDays: z.number().int().positive().default(3),
    })
    .optional()
    .default({
      enabled: true,
      totalErrorThreshold: 0.01,
      dangerSlotThreshold: 0.05,
      dangerMultiplier: 0.5,
      normalMultiplier: 2.0,
      lookbackDays: 3,
    }),
});

export const routesSchema = z.record(z.string(), routeSchema);

// 单个 API Key 的 schema
export const authKeySchema = z.object({
  key: z.string().min(1, 'API key is required'),
  name: z.string().min(1, 'Key name is required'),
  enabled: z.boolean().default(true),
});

// auth 配置块的 schema
export const authSchema = z.object({
  enabled: z.boolean().default(false),
  keys: z.array(authKeySchema).default([]),
});

export const proxyConfigSchema = z.object({
  version: z.literal(1).optional(),
  port: z.number().int().positive().default(3000),
  routes: routesSchema.default({}),
  auth: authSchema.optional(),
});

export function validateProxyConfig(config) {
  try {
    const data = proxyConfigSchema.parse(config);
    return { success: true, data };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
      };
    }
    return { success: false, error: error.message };
  }
}
