// expression.js
// Expression parsing and evaluation logic extracted from parser.js

/**
 * Safe expression parser that supports complex JavaScript expressions
 * while preventing dangerous operations like eval or global access
 */
class ExpressionParser {
    constructor() {
        // Whitelist of safe operators and keywords
        this.safeOperators = [
            '+', '-', '*', '/', '%', '**',
            '==', '===', '!=', '!==', '<', '>', '<=', '>=',
            '&&', '||', '!', '?', ':',
            '.', '[', ']', '(', ')'
        ];
        // Whitelist of safe built-in functions/objects
        this.safeFunctions = new Set([
            'Math', 'String', 'Number', 'Boolean', 'Array', 'Object', 'Date',
            'parseInt', 'parseFloat', 'isNaN', 'isFinite'
        ]);
    }

    /**
     * Evaluates an expression safely within the given context
     * @param {string} expression - The expression to evaluate
     * @param {object} context - The context object containing variables
     * @returns {*} The result of the expression
     */
    evaluate(expression, context) {
        try {
            // Trim and normalize the expression
            expression = expression.trim();
            // Handle empty expressions
            if (!expression) {
                return undefined;
            }
            // Quick path for simple property access
            if (this.isSimplePropertyAccess(expression)) {
                return this.evaluateSimpleAccess(expression, context);
            }
            // Create a safe evaluation function for complex expressions
            const safeEval = this.createSafeEvaluator(expression, context);
            return safeEval();
        } catch (error) {
            console.warn(`Expression evaluation failed: ${expression}`, error);
            return undefined;
        }
    }

    /**
     * Fast path for simple property access like "user.name" or "items[0]"
     * @param {string} expression - The simple expression
     * @param {object} context - The context object
     * @returns {*} The evaluated result
     */
    evaluateSimpleAccess(expression, context) {
        try {
            // Split by dots and handle bracket notation
            const parts = expression.split('.');
            let current = context[parts[0]];
            // Handle reactive root
            current = _reactive(current);
            // Navigate the property chain
            for (let i = 1; i < parts.length; i++) {
                if (current == null) return undefined;
                const part = parts[i];
                // Handle bracket notation like "items[0]"
                const bracketMatch = part.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\[(\d+)\]$/);
                if (bracketMatch) {
                    const [, prop, index] = bracketMatch;
                    current = current[prop];
                    current = _reactive(current);
                    if (Array.isArray(current)) {
                        current = current[parseInt(index, 10)];
                    }
                } else {
                    current = current[part];
                }
                current = _reactive(current);
            }
            return current;
        } catch (error) {
            console.warn(`Simple access evaluation failed: ${expression}`, error);
            return undefined;
        }
    }

    /**
     * Creates a safe evaluator function for the given expression
     * @param {string} expression - The expression to parse
     * @param {object} context - The context object
     * @returns {Function} A function that evaluates the expression
     */
    createSafeEvaluator(expression, context) {
        // Validate the expression for safety
        this.validateExpression(expression);
        // Create a safe context with whitelisted globals
        const safeContext = this.createSafeContext(context);
        // Build the evaluator function
        const paramNames = Object.keys(safeContext);
        const paramValues = Object.values(safeContext);
        // Wrap the expression to handle reactive values
        const wrappedExpression = this.wrapReactiveAccess(expression, paramNames);
        // Create and return the function
        const func = new Function(...paramNames, `return (${wrappedExpression})`);
        return () => func(...paramValues);
    }

    /**
     * Validates an expression for potentially dangerous code
     * @param {string} expression - The expression to validate
     */
    validateExpression(expression) {
        // Check for dangerous patterns
        const dangerousPatterns = [
            /\beval\b/,
            /\bFunction\b/,
            /\bwindow\b/,
            /\bdocument\b/,
            /\bglobal\b/,
            /\bprocess\b/,
            /\brequire\b/,
            /\bimport\b/,
            /\bexport\b/,
            /\b__proto__\b/,
            /\bconstructor\b/,
            /\bprototype\b/
        ];
        for (const pattern of dangerousPatterns) {
            if (pattern.test(expression)) {
                throw new Error(`Unsafe expression: contains forbidden pattern ${pattern}`);
            }
        }
    }

    /**
     * Creates a safe context by wrapping the original context
     * @param {object} context - The original context
     * @returns {object} The safe context
     */
    createSafeContext(context) {
        const safeContext = {};
        // Add context properties
        for (const [key, value] of Object.entries(context)) {
            safeContext[key] = value;
        }
        // Add safe built-in functions
        for (const funcName of this.safeFunctions) {
            if (typeof globalThis[funcName] !== 'undefined') {
                safeContext[funcName] = globalThis[funcName];
            }
        }
        return safeContext;
    }

    /**
     * Wraps property access to handle reactive values (signals)
     * @param {string} expression - The original expression
     * @param {Array} paramNames - Available parameter names
     * @returns {string} The wrapped expression
     */
    wrapReactiveAccess(expression, paramNames) {
        // Enhanced approach with better pattern matching
        let wrappedExpression = expression;
        // Sort parameters by length (longest first) to avoid partial replacements
        const sortedParams = [...paramNames].sort((a, b) => b.length - a.length);
        // Replace property access with reactive-aware access
        for (const param of sortedParams) {
            // More sophisticated regex that avoids replacing parts of other identifiers
            // and handles property access chains
            const regex = new RegExp(`\\b${this.escapeRegex(param)}\\b(?=\\s*[.\\[\\s)*+\\-/=!<>&|?:]|$)`, 'g');
            wrappedExpression = wrappedExpression.replace(regex, `_reactive(${param})`);
        }
        return wrappedExpression;
    }

    /**
     * Escapes special regex characters in a string
     * @param {string} string - The string to escape
     * @returns {string} The escaped string
     */
    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
    }

    /**
     * Checks if an expression is a simple property access
     * @param {string} expression - The expression to check
     * @returns {boolean} True if it's a simple property access
     */
    isSimplePropertyAccess(expression) {
        // Check if expression is just a simple property access like "user.name" or "items[0]"
        const simplePattern = /^[a-zA-Z_$][a-zA-Z0-9_$]*(\.[a-zA-Z_$][a-zA-Z0-9_$]*|\[\d+\])*$/;
        return simplePattern.test(expression.trim());
    }
}

// Create a global instance
const expressionParser = new ExpressionParser();

/**
 * Helper function to safely get reactive values
 * @param {*} value - The value to get (could be a signal/function or regular value)
 * @returns {*} The actual value
 */
function _reactive(value) {
    // Handle null/undefined
    if (value == null) {
        return value;
    }
    // Handle functions (signals)
    if (typeof value === 'function') {
        try {
            const result = value();
            // Recursively handle nested reactive values
            return _reactive(result);
        } catch (error) {
            console.warn('Error getting reactive value:', error);
            return undefined;
        }
    }
    // Handle arrays - make them reactive-aware
    if (Array.isArray(value)) {
        return value.map(item => _reactive(item));
    }
    // Handle plain objects - make properties reactive-aware for deep access
    if (value && typeof value === 'object' && value.constructor === Object) {
        const reactiveObj = {};
        for (const [key, val] of Object.entries(value)) {
            reactiveObj[key] = _reactive(val);
        }
        return reactiveObj;
    }
    // Return primitive values as-is
    return value;
}

/**
 * Safely evaluates an expression in the given context
 * @param {string} expression - The expression to evaluate
 * @param {object} context - The context containing variables
 * @returns {*} The evaluated result
 */
function evaluateExpression(expression, context) {
    // Add the reactive helper to the context
    const enhancedContext = {
        ...context,
        _reactive
    };
    return expressionParser.evaluate(expression, enhancedContext);
}

export { ExpressionParser, expressionParser, _reactive, evaluateExpression };
