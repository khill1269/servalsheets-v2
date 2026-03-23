/**
 * Shared auth path helpers.
 */

import { homedir, tmpdir } from 'os';
import { ValidationError } from '../core/errors.js';
import { join, resolve, isAbsolute } from 'path';

export function getDefaultTokenStorePath(): string {
  return join(homedir(), '.servalsheets', 'tokens.encrypted');
}

/**
 * Normalize a token store path to prevent directory traversal attacks.
 * Resolves `..` components and ensures the result is an absolute path.
 */
export function sanitizeTokenStorePath(rawPath: string): string {
  // resolve() collapses any ../.. traversal sequences into an absolute path
  const resolved = isAbsolute(rawPath) ? resolve(rawPath) : resolve(process.cwd(), rawPath);
  // Defense-in-depth: constrain to home or temp directory to prevent access to /etc, /proc, etc.
  const allowedPrefixes = [homedir(), tmpdir()];
  if (!allowedPrefixes.some((prefix) => resolved.startsWith(prefix))) {
    throw new ValidationError(
      `Token store path must be within home or temp directory. Got: ${resolved}`,
      'tokenStorePath'
    );
  }
  return resolved;
}
