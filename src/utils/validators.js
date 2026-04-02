import { z } from 'zod';

const reservedNames = ['current', 'default', 'active', 'null', 'undefined', 'true', 'false'];

export const profileNameSchema = z
  .string()
  .min(1, 'Profile name cannot be empty')
  .max(50, 'Profile name cannot exceed 50 characters')
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9_-]*[a-zA-Z0-9]$/,
    'Profile name must start and end with alphanumeric characters, and can only contain letters, numbers, hyphens, and underscores'
  )
  .refine((name) => !reservedNames.includes(name.toLowerCase()), {
    message: 'Profile name is reserved',
  });

export const profilesMetadataSchema = z.object({
  version: z.literal(1),
  activeProfile: profileNameSchema.nullable(),
  profiles: z.record(
    profileNameSchema,
    z.object({
      name: profileNameSchema,
      description: z.string().max(200).optional(),
      createdAt: z.string().datetime(),
      updatedAt: z.string().datetime(),
      lastUsedAt: z.string().datetime().optional(),
      isDefault: z.boolean().default(false),
    })
  ),
});

export const opencodeConfigSchema = z.object({}).passthrough();

export const variableNameSchema = z
  .string()
  .min(1, 'Variable name cannot be empty')
  .max(
    64,
    'Variable name must be UPPER_SNAKE_CASE (letters, numbers, underscore), max 64 characters, starting with a letter'
  )
  .regex(
    /^[A-Z][A-Z0-9_]*$/,
    'Variable name must be UPPER_SNAKE_CASE (letters, numbers, underscore), max 64 characters, starting with a letter'
  );

export function validateProfileName(name) {
  try {
    profileNameSchema.parse(name);
    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: error.errors.map((e) => e.message).join(', '),
      };
    }
    return { success: false, error: error.message };
  }
}

export function validateProfilesMetadata(metadata) {
  try {
    const data = profilesMetadataSchema.parse(metadata);
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

export function validateVariableName(name) {
  try {
    const data = variableNameSchema.parse(name);
    return { success: true, data };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: error.errors.map((e) => e.message).join(', '),
      };
    }
    return { success: false, error: error.message };
  }
}

// Schema for model values that supports both string and Array<string>
const nonEmptyStringSchema = z
  .string()
  .min(1, 'Model value cannot be empty')
  .refine((val) => val.trim().length > 0, 'Model value cannot be whitespace only');

const modelArraySchema = z
  .array(nonEmptyStringSchema)
  .min(1, 'Model array must contain at least one model');

export const modelValueSchema = z.union([nonEmptyStringSchema, modelArraySchema]);

export function validateModelValue(value) {
  try {
    // First, parse with the schema to validate types
    const parsed = modelValueSchema.parse(value);

    // Handle deduplication for arrays
    let data = parsed;
    if (Array.isArray(data)) {
      // Remove duplicates while preserving order
      data = [...new Set(data)];
    }

    return { success: true, data };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: error.errors.map((e) => e.message).join(', '),
      };
    }
    return { success: false, error: error.message };
  }
}
