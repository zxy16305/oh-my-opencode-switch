/**
 * Recursively fix enum types in a JSON schema.
 * Adds `type: 'string'` to enum fields that are missing a type
 * when all enum values are strings.
 */

/**
 * Fix enum types recursively in a schema value.
 * @param {*} schema - Any JSON value (object, array, primitive)
 * @returns {*} New value with enum types fixed (does NOT mutate input)
 */
export function fixEnumTypes(schema) {
  if (schema === null || typeof schema !== 'object') {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map((item) => fixEnumTypes(item));
  }

  const obj = schema;

  if (
    Array.isArray(obj.enum) &&
    !obj.type &&
    obj.enum.every((v) => typeof v === 'string')
  ) {
    const fixed = { ...obj, type: 'string' };
    return fixObjectProperties(fixed);
  }

  return fixObjectProperties(obj);
}

/**
 * Recursively process all properties of an object.
 * @param {object} obj
 * @returns {object} New object with all values processed
 */
function fixObjectProperties(obj) {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && typeof value === 'object') {
      result[key] = fixEnumTypes(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Fix tools/list response by applying enum type fixes to tool schemas.
 * @param {object} jsonrpcMessage - Parsed JSON-RPC message object
 * @returns {object} Modified message or original if not a tools/list response
 */
export function fixToolsListResponse(jsonrpcMessage) {
  if (
    !jsonrpcMessage ||
    !jsonrpcMessage.result ||
    !Array.isArray(jsonrpcMessage.result.tools)
  ) {
    return jsonrpcMessage;
  }

  const tools = jsonrpcMessage.result.tools.map((tool) => {
    const updates = {};
    if (tool.inputSchema) {
      updates.inputSchema = fixEnumTypes(tool.inputSchema);
    }
    if (tool.outputSchema) {
      updates.outputSchema = fixEnumTypes(tool.outputSchema);
    }
    if (Object.keys(updates).length === 0) {
      return tool;
    }
    return { ...tool, ...updates };
  });

  return {
    ...jsonrpcMessage,
    result: {
      ...jsonrpcMessage.result,
      tools,
    },
  };
}
