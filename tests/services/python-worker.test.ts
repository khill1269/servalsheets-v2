/**
 * Python Worker — sandbox validation unit tests
 *
 * buildSandboxCode and ALLOWED_MODULES are not exported from
 * python-worker.ts (it is a worker_threads script). These tests
 * inline the same constants and logic so security regressions are
 * caught without a live Pyodide/WASM instance.
 *
 * If the implementation changes, update both the source and these
 * inline copies together.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Inline copy of ALLOWED_MODULES from src/services/python-worker.ts
// ---------------------------------------------------------------------------

const ALLOWED_MODULES = new Set([
  'math',
  'statistics',
  'json',
  're',
  'datetime',
  'collections',
  'itertools',
  'functools',
  'operator',
  'string',
  'io',
  '_io',
  'numbers',
  'decimal',
  'fractions',
  'cmath',
  'copy',
  'typing',
  'enum',
  'dataclasses',
  'abc',
  'contextlib',
  'warnings',
  'pprint',
  'numpy',
  'pandas',
  'scipy',
  'matplotlib',
]);

// ---------------------------------------------------------------------------
// Inline copy of buildSandboxCode from src/services/python-worker.ts
// ---------------------------------------------------------------------------

function buildSandboxCode(userCode: string): string {
  const allowedList = JSON.stringify([...ALLOWED_MODULES]);
  return `
import builtins as _builtins
import sys as _sys
import io as _io

# --- Allowlist-based import restriction ---
_ALLOWED = frozenset(${allowedList})
_orig_import = _builtins.__import__

def _safe_import(name, *args, **kwargs):
    base = name.split('.')[0]
    if base not in _ALLOWED:
        raise ImportError(f"Module '{{name}}' is not permitted in this sandbox")
    return _orig_import(name, *args, **kwargs)

_builtins.__import__ = _safe_import

# --- Remove dangerous builtins ---
for _attr in ('open', 'exec', 'compile'):
    try:
        delattr(_builtins, _attr)
    except AttributeError:
        pass

def _blocked_exec(*args, **kwargs):
    raise RuntimeError("exec() is not permitted in this sandbox")

def _blocked_compile(*args, **kwargs):
    raise RuntimeError("compile() is not permitted in this sandbox")

def _blocked_open(*args, **kwargs):
    raise RuntimeError("open() is not permitted in this sandbox")

_builtins.exec = _blocked_exec
_builtins.compile = _blocked_compile
_builtins.open = _blocked_open

# --- Capture stdout ---
_stdout_capture = _io.StringIO()
_sys.stdout = _stdout_capture

# --- User code ---
${userCode}

_output = _stdout_capture.getvalue()
`;
}

// ---------------------------------------------------------------------------
// Helper — simulated import check matching _safe_import behaviour
// ---------------------------------------------------------------------------

function isModuleAllowed(importName: string): boolean {
  const base = importName.split('.')[0]!;
  return ALLOWED_MODULES.has(base);
}

// ---------------------------------------------------------------------------
// ALLOWED_MODULES allowlist
// ---------------------------------------------------------------------------

describe('ALLOWED_MODULES allowlist', () => {
  it('allows math', () => {
    expect(isModuleAllowed('math')).toBe(true);
  });

  it('allows numpy', () => {
    expect(isModuleAllowed('numpy')).toBe(true);
  });

  it('allows pandas', () => {
    expect(isModuleAllowed('pandas')).toBe(true);
  });

  it('allows scipy', () => {
    expect(isModuleAllowed('scipy')).toBe(true);
  });

  it('allows matplotlib', () => {
    expect(isModuleAllowed('matplotlib')).toBe(true);
  });

  it('allows sub-module of an allowed package (numpy.linalg)', () => {
    expect(isModuleAllowed('numpy.linalg')).toBe(true);
  });

  it('allows sub-module of an allowed package (matplotlib.pyplot)', () => {
    expect(isModuleAllowed('matplotlib.pyplot')).toBe(true);
  });

  it('blocks os', () => {
    expect(isModuleAllowed('os')).toBe(false);
  });

  it('blocks sys', () => {
    expect(isModuleAllowed('sys')).toBe(false);
  });

  it('blocks subprocess', () => {
    expect(isModuleAllowed('subprocess')).toBe(false);
  });

  it('blocks socket', () => {
    expect(isModuleAllowed('socket')).toBe(false);
  });

  it('blocks shutil', () => {
    expect(isModuleAllowed('shutil')).toBe(false);
  });

  it('blocks pickle', () => {
    expect(isModuleAllowed('pickle')).toBe(false);
  });

  it('blocks ctypes', () => {
    expect(isModuleAllowed('ctypes')).toBe(false);
  });

  it('blocks importlib', () => {
    expect(isModuleAllowed('importlib')).toBe(false);
  });

  it('blocks builtins (direct import attempt)', () => {
    expect(isModuleAllowed('builtins')).toBe(false);
  });

  it('blocks pathlib', () => {
    expect(isModuleAllowed('pathlib')).toBe(false);
  });

  it('blocks glob', () => {
    expect(isModuleAllowed('glob')).toBe(false);
  });

  it('does not allow sub-module bypass (os.path)', () => {
    // Attacker uses "os.path" hoping base extraction fails — base is "os", blocked.
    expect(isModuleAllowed('os.path')).toBe(false);
  });

  it('does not allow sub-module bypass (subprocess.run)', () => {
    expect(isModuleAllowed('subprocess.run')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildSandboxCode structure
// ---------------------------------------------------------------------------

describe('buildSandboxCode', () => {
  it('contains the _safe_import hook', () => {
    const code = buildSandboxCode('x = 1');
    expect(code).toContain('_builtins.__import__ = _safe_import');
  });

  it('blocks open() via replacement function', () => {
    const code = buildSandboxCode('x = 1');
    expect(code).toContain('_blocked_open');
    expect(code).toContain("open() is not permitted in this sandbox");
  });

  it('blocks exec() via replacement function', () => {
    const code = buildSandboxCode('x = 1');
    expect(code).toContain('_blocked_exec');
    expect(code).toContain("exec() is not permitted in this sandbox");
  });

  it('blocks compile() via replacement function', () => {
    const code = buildSandboxCode('x = 1');
    expect(code).toContain('_blocked_compile');
    expect(code).toContain("compile() is not permitted in this sandbox");
  });

  it('removes open from builtins before re-assigning blocked stub', () => {
    const code = buildSandboxCode('x = 1');
    // The delattr loop must appear before the stub assignments.
    const delattrIdx = code.indexOf("for _attr in ('open', 'exec', 'compile')");
    const stubIdx = code.indexOf('_builtins.open = _blocked_open');
    expect(delattrIdx).toBeGreaterThan(-1);
    expect(stubIdx).toBeGreaterThan(-1);
    expect(delattrIdx).toBeLessThan(stubIdx);
  });

  it('embeds frozenset of allowed modules in generated code', () => {
    const code = buildSandboxCode('x = 1');
    // The allowlist is serialised as a JSON array then wrapped in frozenset().
    expect(code).toContain('_ALLOWED = frozenset(');
    // Spot-check a few expected module names in the serialised list.
    expect(code).toContain('"numpy"');
    expect(code).toContain('"pandas"');
    expect(code).toContain('"math"');
  });

  it('embeds user code into the generated sandbox wrapper', () => {
    const userCode = 'result = 2 + 2';
    const code = buildSandboxCode(userCode);
    expect(code).toContain(userCode);
  });

  it('captures stdout via StringIO redirect', () => {
    const code = buildSandboxCode('print("hello")');
    expect(code).toContain('_stdout_capture = _io.StringIO()');
    expect(code).toContain('_sys.stdout = _stdout_capture');
    expect(code).toContain('_output = _stdout_capture.getvalue()');
  });

  it('generated code does NOT contain a bare import of os or sys at top level', () => {
    const code = buildSandboxCode('x = 1');
    // The sandbox imports _sys and _io under private names; it must not import
    // them under their public names where user code could grab the reference.
    expect(code).not.toMatch(/^import os$/m);
    // _sys is imported under a private alias — confirm no bare "import sys"
    expect(code).not.toMatch(/^import sys$/m);
  });
});
