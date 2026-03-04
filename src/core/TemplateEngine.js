import Handlebars from 'handlebars';
import {
  MissingVariableError,
  CircularReferenceError,
  TemplateSyntaxError,
} from '../utils/errors.js';

/**
 * TemplateEngine - Handlebars-based template rendering with variable substitution
 * Supports {{VARIABLE}} syntax for value replacement only (no logic constructs)
 */
export class TemplateEngine {
  constructor() {
    // Compile regex to detect Handlebars logic constructs
    this.logicPattern = /\{\{[#/]\s*(if|each|unless|else|with)\s*[^}]*\}\}/g;
    // Pattern to find all variable references in template
    this.variablePattern = /\{\{\s*([A-Z_][A-Z0-9_]*)\s*\}\}/g;
    // Track visited variables for circular reference detection
    this._visitedVariables = null;
  }

  /**
   * Render a template by substituting variables
   * @param {string} template - Template string with {{VARIABLE}} placeholders
   * @param {Object} variables - Object containing variable name -> value mappings
   * @returns {string} Rendered template with variables substituted
   * @throws {TemplateSyntaxError} If template contains logic constructs (#if, #each, #unless)
   * @throws {MissingVariableError} If a variable in template is not provided
   * @throws {CircularReferenceError} If circular reference detected in variable values
   */
  render(template, variables = {}) {
    // Validate that no logic constructs are present
    this._validateNoLogicConstructs(template);

    // Reset visited variables tracker for circular reference detection
    this._visitedVariables = new Set();

    // Find all required variables from template
    const requiredVariables = this._extractVariables(template);

    // Check for missing variables (undefined values are also considered missing)
    for (const varName of requiredVariables) {
      if (!(varName in variables) || variables[varName] === undefined) {
        throw new MissingVariableError(varName);
      }
    }

    // Check for circular references in variable values
    this._checkCircularReferences(variables);

    // Prepare variables for Handlebars (stringify objects/arrays)
    const processedVariables = this._processVariables(variables);

    // Compile and render the template (disable HTML escaping for JSON configs)
    const compiledTemplate = Handlebars.compile(template, { noEscape: true });
    return compiledTemplate(processedVariables);
  }

  /**
   * Validate that template does not contain logic constructs
   * @param {string} template - Template to validate
   * @throws {TemplateSyntaxError} If logic constructs found
   * @private
   */
  _validateNoLogicConstructs(template) {
    const matches = template.match(this.logicPattern);
    if (matches) {
      const found = [
        ...new Set(matches.map((m) => m.match(/#(\w+)/)?.[1] || m.match(/\/(\w+)/)?.[1])),
      ];
      throw new TemplateSyntaxError(
        0,
        `Logic constructs are not supported: found ${found.join(', ')}`
      );
    }
  }

  /**
   * Extract all variable names from a template
   * @param {string} template - Template to extract variables from
   * @returns {Set<string>} Set of variable names found in template
   * @private
   */
  _extractVariables(template) {
    const variables = new Set();
    let match;
    // Reset regex lastIndex
    this.variablePattern.lastIndex = 0;
    while ((match = this.variablePattern.exec(template)) !== null) {
      variables.add(match[1]);
    }
    return variables;
  }

  /**
   * Check for circular references in variable values
   * @param {Object} variables - Variables object to check
   * @throws {CircularReferenceError} If circular reference detected
   * @private
   */
  _checkCircularReferences(variables) {
    for (const [varName, value] of Object.entries(variables)) {
      const path = [varName];
      this._detectCircularInValue(value, path, variables);
    }
  }

  /**
   * Recursively detect circular references in a value
   * @param {any} value - Value to check
   * @param {string[]} path - Current path of variable names
   * @param {Object} allVariables - All variables for cross-reference checking
   * @throws {CircularReferenceError} If circular reference detected
   * @private
   */
  _detectCircularInValue(value, path, allVariables) {
    // Create a unique key for this value
    const valueKey = this._getValueKey(value);

    if (valueKey && this._visitedVariables.has(valueKey)) {
      // This exact object has been visited - potential circular reference
      // But only throw if we're in a recursive chain
      return;
    }

    if (valueKey) {
      this._visitedVariables.add(valueKey);
    }

    if (typeof value === 'string') {
      // Check if string value references other variables (like "{{OTHER_VAR}}")
      const referencedVars = this._extractVariables(value);
      for (const refVar of referencedVars) {
        if (path.includes(refVar)) {
          throw new CircularReferenceError([...path, refVar]);
        }
        if (refVar in allVariables) {
          const newPath = [...path, refVar];
          this._detectCircularInValue(allVariables[refVar], newPath, allVariables);
        }
      }
    } else if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        this._detectCircularInValue(value[i], path, allVariables);
      }
    } else if (value !== null && typeof value === 'object') {
      for (const nestedValue of Object.values(value)) {
        this._detectCircularInValue(nestedValue, path, allVariables);
      }
    }
  }

  /**
   * Get a unique key for a value (for tracking visited objects)
   * @param {any} value - Value to get key for
   * @returns {string|null} Unique key or null for primitives
   * @private
   */
  _getValueKey(value) {
    if (value === null || typeof value !== 'object') {
      return null;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }

  /**
   * Process variables for Handlebars - stringify objects and arrays, resolve nested references
   * @param {Object} variables - Raw variables
   * @returns {Object} Processed variables ready for Handlebars
   * @private
   */
  _processVariables(variables) {
    const processed = {};
    const resolving = new Set();

    const resolveValue = (value, path) => {
      if (typeof value === 'string') {
        const stringVars = this._extractVariables(value);
        let result = value;
        for (const varName of stringVars) {
          if (resolving.has(varName)) {
            continue;
          }
          if (varName in variables) {
            resolving.add(varName);
            const resolvedVar = resolveValue(variables[varName], [...path, varName]);
            resolving.delete(varName);
            const replacement =
              typeof resolvedVar === 'string' ? resolvedVar : JSON.stringify(resolvedVar);
            result = result.replace(new RegExp(`\\{\\{\\s*${varName}\\s*\\}\\}`, 'g'), replacement);
          }
        }
        return result;
      }
      return this._processValue(value);
    };

    for (const [key, value] of Object.entries(variables)) {
      resolving.add(key);
      processed[key] = resolveValue(value, [key]);
      resolving.delete(key);
    }
    return processed;
  }

  /**
   * Process a single value for Handlebars
   * @param {any} value - Value to process
   * @returns {string|number|boolean|null} Processed value
   * @private
   */
  _processValue(value) {
    if (value === null) {
      return 'null';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    if (Array.isArray(value) || typeof value === 'object') {
      return JSON.stringify(value);
    }
    // Fallback for other types
    return String(value);
  }

  /**
   * Check if a string is a valid template
   * @param {string} template - Template to validate
   * @returns {Object} { valid: boolean, error?: string }
   */
  validate(template) {
    try {
      this._validateNoLogicConstructs(template);
      return { valid: true };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }
}

export default TemplateEngine;
