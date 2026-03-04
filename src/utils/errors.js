/**
 * Exit codes for OOS CLI
 */
export const EXIT_SUCCESS = 0;
export const EXIT_ERROR = 1;
export const EXIT_VALIDATION = 2;
export const EXIT_NOT_FOUND = 3;
export const EXIT_EXISTS = 4;
export const EXIT_PERMISSION = 5;

/**
 * Base error class for OOS CLI
 */
export class OosError extends Error {
  constructor(message, code, exitCode = EXIT_ERROR) {
    super(`${message} (${code})`);
    this.name = 'OosError';
    this.code = code;
    this.exitCode = exitCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Configuration-related errors
 */
export class ConfigError extends OosError {
  constructor(message, code = 'E002') {
    super(message, code, EXIT_VALIDATION);
    this.name = 'ConfigError';
  }
}

/**
 * Profile-related errors
 */
export class ProfileError extends OosError {
  constructor(message, code = 'E001') {
    super(message, code, EXIT_ERROR);
    this.name = 'ProfileError';
  }
}

/**
 * File system errors
 */
export class FileSystemError extends OosError {
  constructor(message, code = 'E005') {
    super(message, code, EXIT_PERMISSION);
    this.name = 'FileSystemError';
  }
}

/**
 * Missing required variable error
 */
export class MissingVariableError extends OosError {
  constructor(variableName) {
    super(`Missing required variable: ${variableName}`, 'E010', EXIT_VALIDATION);
    this.name = 'MissingVariableError';
    this.variableName = variableName;
  }
}

/**
 * Circular reference detected error
 */
export class CircularReferenceError extends OosError {
  constructor(variablePath) {
    super(`Circular reference detected: ${variablePath.join(' -> ')}`, 'E011', EXIT_VALIDATION);
    this.name = 'CircularReferenceError';
    this.variablePath = variablePath;
  }
}

/**
 * Template syntax error
 */
export class TemplateSyntaxError extends OosError {
  constructor(position, details) {
    super(`Template syntax error at position ${position}: ${details}`, 'E012', EXIT_VALIDATION);
    this.name = 'TemplateSyntaxError';
    this.position = position;
    this.details = details;
  }
}

/**
 * Variable validation error
 */
export class VariableValidationError extends OosError {
  constructor(variableName, reason) {
    super(`Invalid variable name '${variableName}': ${reason}`, 'E013', EXIT_VALIDATION);
    this.name = 'VariableValidationError';
    this.variableName = variableName;
    this.reason = reason;
  }
}
