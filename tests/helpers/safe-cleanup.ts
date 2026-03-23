/**
 * Safe file cleanup utilities for test environments.
 *
 * In sandboxed environments (e.g., containers, CI), file deletion may be
 * blocked by EPERM even with force:true. These wrappers swallow EPERM
 * errors during test cleanup so that passing tests don't fail on teardown.
 */
import * as fs from 'fs';

/**
 * Like fs.rmSync but silently ignores EPERM errors.
 * Use in afterEach/afterAll cleanup blocks.
 */
export function safeRmSync(filePath: string, options?: fs.RmOptions): void {
  try {
    fs.rmSync(filePath, options);
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EPERM' || code === 'EACCES') return;
    throw e;
  }
}

/**
 * Like fs.unlinkSync but silently ignores EPERM errors.
 * Use in afterEach/afterAll cleanup blocks.
 */
export function safeUnlinkSync(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EPERM' || code === 'EACCES') return;
    throw e;
  }
}
