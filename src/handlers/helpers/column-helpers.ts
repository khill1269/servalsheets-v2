/**
 * ServalSheets - Column Conversion Helper Functions
 *
 * Pure utility functions for converting between column indices and letters.
 * Extracted from BaseHandler for better modularity and independent testing.
 */

import { memoize } from '../../utils/memoization.js';

/**
 * Memoized column conversion functions for performance
 * Shared across all handler instances
 */
export const columnToLetter = memoize(
  (index: number): string => {
    let letter = '';
    let temp = index + 1;
    while (temp > 0) {
      const mod = (temp - 1) % 26;
      letter = String.fromCharCode(65 + mod) + letter;
      temp = Math.floor((temp - 1) / 26);
    }
    return letter;
  },
  { maxSize: 500, ttl: 300000 }
); // Cache 500 entries for 5 minutes

export const letterToColumn = memoize(
  (letter: string): number => {
    let index = 0;
    for (let i = 0; i < letter.length; i++) {
      index = index * 26 + (letter.charCodeAt(i) - 64);
    }
    return index - 1;
  },
  { maxSize: 500, ttl: 300000 }
);
