// diagnostics.js
// Stable diagnostic codes for template compile and runtime failures.
// Codes stay greppable (BD1xxx). They include the file, expression, and a fix
// hint when those are known. This module does not import the router or fetch.

/**
 * @param {string} code
 * @param {string} message
 * @param {{ file?: string, expression?: string, hint?: string, devOnly?: boolean }} [details]
 * @returns {Error}
 */
export function reportDiagnostic(code, message, details = {}) {
  const where = details.file ? ` (${details.file})` : '';
  const expr = details.expression ? ` expression: ${details.expression}` : '';
  const hint = details.hint ? ` Fix: ${details.hint}` : '';
  const text = `[BaseDOM ${code}]${where} ${message}.${expr}${hint}`;
  const error = new Error(text);
  error.code = code;
  error.details = details;
  if (!(details.devOnly && globalThis.__BASEDOM_DEV__ === false)) console.error(text);
  return error;
}
