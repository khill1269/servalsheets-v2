/**
 * Python Worker — runs inside a worker_threads Worker.
 *
 * Receives WorkerRequest via workerData, executes Python code
 * in a sandboxed Pyodide instance, and posts the result back via parentPort.
 *
 * Each invocation spawns a fresh worker to prevent global state pollution.
 */

import { workerData, parentPort } from 'worker_threads';

interface WorkerRequest {
  code: string;
  globals: Record<string, unknown>;
  timeoutMs: number;
}

interface WorkerSuccess {
  success: true;
  output: string;
  result: unknown;
  executionMs: number;
}

interface WorkerFailure {
  success: false;
  error: string;
}

function suppressPyodideOutput(_message?: string): void {
  // Worker-side package progress is not useful to callers and must never bleed
  // into the parent process stdout stream.
}

// Allowlisted modules — only these can be imported in sandboxed code
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
  'textwrap',
  'unicodedata',
  'hashlib',
  'base64',
  'csv',
  'dateutil', // P2-1 fix: dateutil needed for date parsing in ETL workflows
  'dateutil.parser',
  'dateutil.tz',
  'dateutil.relativedelta',
  'numpy',
  'pandas',
  'scipy',
  'matplotlib',
]);

/**
 * SECURITY: Pre-validate Python code for sandbox escape patterns.
 * This runs BEFORE the code enters the Pyodide sandbox, blocking
 * attempts to tamper with the sandbox infrastructure itself.
 */
const SANDBOX_ESCAPE_PATTERNS = [
  // Attempts to restore original import
  { pattern: /_orig_import\b/, reason: 'Attempt to access sandbox internals (_orig_import)' },
  { pattern: /__import__\s*=/, reason: 'Attempt to reassign __import__' },
  // Direct builtins manipulation
  { pattern: /_builtins\b/, reason: 'Attempt to access sandbox internals (_builtins)' },
  { pattern: /builtins\.__import__/, reason: 'Attempt to access builtins.__import__' },
  // importlib bypass
  { pattern: /importlib/, reason: 'importlib is not permitted (sandbox bypass risk)' },
  // ctypes (native code execution)
  { pattern: /\bctypes\b/, reason: 'ctypes is not permitted (native code execution risk)' },
  // Subprocess / os access via string manipulation
  { pattern: /getattr\s*\(\s*__builtins__/, reason: 'getattr on __builtins__ is not permitted' },
  { pattern: /__subclasses__/, reason: '__subclasses__ traversal is not permitted' },
  { pattern: /__class__\s*\.\s*__bases__/, reason: 'MRO traversal is not permitted' },
  // eval() can execute arbitrary code
  { pattern: /\beval\s*\(/, reason: 'eval() is not permitted in this sandbox' },
];

function validatePythonCode(code: string): void {
  for (const { pattern, reason } of SANDBOX_ESCAPE_PATTERNS) {
    if (pattern.test(code)) {
      throw new Error(`Security violation: ${reason}`);
    }
  }
}

function buildSandboxCode(userCode: string): string {
  // Pre-validate before embedding in sandbox wrapper
  validatePythonCode(userCode);

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
# BUG-9 fix: Keep compile() available — Pyodide/CPython internals use it for
# list comprehensions, f-strings, class bodies, and generator expressions.
# Blocking compile() breaks basic Python constructs. Only block exec() and open()
# which are the actual security risks (arbitrary code execution, file system access).
for _attr in ('open', 'exec'):
    try:
        delattr(_builtins, _attr)
    except AttributeError:
        pass

def _blocked_exec(*args, **kwargs):
    raise RuntimeError("exec() is not permitted in this sandbox")

def _blocked_open(*args, **kwargs):
    raise RuntimeError("open() is not permitted in this sandbox")

_builtins.exec = _blocked_exec
_builtins.open = _blocked_open

# --- Capture stdout ---
_stdout_capture = _io.StringIO()
_sys.stdout = _stdout_capture

# --- User code ---
${userCode}

_output = _stdout_capture.getvalue()
`;
}

async function runPython(): Promise<void> {
  try {
    const req = workerData as WorkerRequest;

    const pyodideModule = (await import('pyodide')) as {
      loadPyodide: (opts?: {
        indexURL?: string;
        packageCacheDir?: string;
        stdout?: (msg: string) => void;
        stderr?: (msg: string) => void;
      }) => Promise<unknown>;
    };

    // FIX-03: Wire PYODIDE_CACHE_DIR to worker's loadPyodide for faster cold starts
    const cacheDir = process.env['PYODIDE_CACHE_DIR'];
    const loadOptions: {
      packageCacheDir?: string;
      stdout?: (msg: string) => void;
      stderr?: (msg: string) => void;
    } = {
      stdout: suppressPyodideOutput,
      stderr: suppressPyodideOutput,
    };
    if (cacheDir) {
      loadOptions.packageCacheDir = cacheDir;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const py: any = await pyodideModule.loadPyodide(loadOptions);

    if (typeof py.setStdout === 'function') {
      py.setStdout({ batched: suppressPyodideOutput });
    }
    if (typeof py.setStderr === 'function') {
      py.setStderr({ batched: suppressPyodideOutput });
    }

    await py.loadPackage(['numpy', 'pandas', 'scipy', 'matplotlib'], {
      messageCallback: suppressPyodideOutput,
      errorCallback: suppressPyodideOutput,
    });

    // Inject caller globals into the Python namespace
    for (const [k, v] of Object.entries(req.globals)) {
      py.globals.set(k, py.toPy(v));
    }

    const start = Date.now();
    const sandboxCode = buildSandboxCode(req.code);
    py.runPython(sandboxCode);

    const output = (py.globals.get('_output') as string) ?? '';
    const executionMs = Date.now() - start;

    const result: WorkerSuccess = {
      success: true,
      output,
      result: null,
      executionMs,
    };

    parentPort?.postMessage(result);
  } catch (err) {
    const result: WorkerFailure = {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
    parentPort?.postMessage(result);
  }
}

void runPython();
