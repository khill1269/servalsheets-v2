#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const auditRootRel = path.join('docs', 'development', 'complete-file-audit');
const auditRootAbs = path.join(cwd, auditRootRel);
const reportAbs = path.join(cwd, 'docs', 'development', 'COMPLETE_FILE_AUDIT.md');

const dirSummaryAbs = path.join(auditRootAbs, 'summaries');
const allChunksAbs = path.join(auditRootAbs, 'chunks', 'all');
const mdChunksAbs = path.join(auditRootAbs, 'chunks', 'md');

// Ensure each run is snapshot-clean (no stale chunk files from prior runs).
fs.rmSync(auditRootAbs, { recursive: true, force: true });

for (const dir of [auditRootAbs, dirSummaryAbs, allChunksAbs, mdChunksAbs]) {
  fs.mkdirSync(dir, { recursive: true });
}

const generatedTopLevel = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  '.data',
  '.performance-history',
  'audit-output',
]);

const coreTopLevel = new Set([
  'src',
  'tests',
  'docs',
  'scripts',
  'deployment',
  'packages',
  'tools',
  'add-on',
  '.github',
  '.vscode',
  '.serval',
  '.agent-context',
  'k8s',
  'database',
  'benchmarks',
  'examples',
  'skill',
]);

const rootControlPatterns = [
  /^package\.json$/,
  /^package-lock\.json$/,
  /^tsconfig(\..+)?\.json$/,
  /^eslint\.config\.js$/,
  /^server\.json$/,
  /^openapi\.(json|yaml|yml)$/,
  /^docker-compose\.yml$/,
  /^Dockerfile$/,
  /^turbo\.json$/,
  /^typedoc\.json$/,
  /^vite\.config\.ts$/,
  /^vitest\.config\.ts$/,
  /^knip\.json$/,
  /^manifest\.json$/,
  /^performance-baselines\.json$/,
  /^\.gitignore$/,
  /^\.gitattributes$/,
  /^\.editorconfig$/,
  /^\.dockerignore$/,
  /^\.npmignore$/,
  /^\.nvmrc$/,
  /^\.prettierignore$/,
  /^\.prettierrc\.json$/,
  /^\.markdownlint\.json$/,
  /^\.markdownlintignore$/,
  /^\.cspell\.json$/,
  /^\.dependency-cruiser\.cjs$/,
  /^\.syncpackrc\.json$/,
  /^\.vale\.ini$/,
  /^\.mcp\.json$/,
  /^\.tsprunerc$/,
];

const archiveCandidateExtensions = new Set([
  'docx',
  'xlsx',
  'xlsx#',
  'pptx',
  'pdf',
  'html',
  'csv',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'zip',
  'gz',
  'tar',
  'map',
  'o',
  'woff',
  'woff2',
  'ttf',
  'snap',
  'log',
]);

const chunkSize = 50000;

function getExtension(name) {
  const lastDot = name.lastIndexOf('.');
  if (lastDot === -1 || lastDot === name.length - 1) {
    return '(no_ext)';
  }
  if (lastDot === 0) {
    const second = name.indexOf('.', 1);
    if (second === -1) {
      return name.slice(1).toLowerCase() || '(no_ext)';
    }
    return name.slice(second + 1).toLowerCase() || '(no_ext)';
  }
  return name.slice(lastDot + 1).toLowerCase();
}

function toTopLevel(relPath) {
  return relPath.includes('/') ? relPath.split('/')[0] : '(root)';
}

function isRootRuntimeArtifact(relPath) {
  return !relPath.includes('/') && (
    relPath === '.eslintcache' ||
    relPath === '.tsbuildinfo' ||
    relPath === '.tsbuildinfo.build' ||
    relPath.startsWith('.~lock.')
  );
}

function isRootControl(relPath) {
  if (relPath.includes('/')) {
    return false;
  }
  return rootControlPatterns.some((re) => re.test(relPath));
}

function classify(relPath, topLevel, extension) {
  if (generatedTopLevel.has(topLevel) || isRootRuntimeArtifact(relPath)) {
    return {
      status: 'EXCLUDE_RUNTIME_ARTIFACT',
      cleanup_action: 'IGNORE_GENERATED',
      reason: 'generated/dependency/runtime artifact',
    };
  }

  if (extension === 'md') {
    return {
      status: 'REAUDIT_NOW',
      cleanup_action: 'REVIEW_CONTENT',
      reason: 'markdown documentation/planning file',
    };
  }

  if (coreTopLevel.has(topLevel) || isRootControl(relPath)) {
    return {
      status: 'REAUDIT_NOW',
      cleanup_action: 'REVIEW_TECHNICAL',
      reason: 'core source/config/test/ops path',
    };
  }

  if (archiveCandidateExtensions.has(extension)) {
    return {
      status: 'REAUDIT_LATER',
      cleanup_action: 'ARCHIVE_CANDIDATE',
      reason: 'binary/report/support artifact',
    };
  }

  return {
    status: 'REAUDIT_LATER',
    cleanup_action: 'REVIEW_LATER',
    reason: 'non-core file, lower priority',
  };
}

function tsvEscape(value) {
  return String(value).replace(/\t/g, ' ').replace(/\n/g, ' ');
}

function asTsv(fields) {
  return fields.map(tsvEscape).join('\t');
}

function writeTsv(filePath, header, lines) {
  fs.writeFileSync(filePath, `${header.join('\t')}\n${lines.join('\n')}\n`, 'utf8');
}

function safeSegment(name) {
  if (name === '(root)') {
    return '_root';
  }
  return name.replace(/[^A-Za-z0-9._-]/g, '_');
}

function sortTopLevel(a, b) {
  if (a === '(root)') {
    return -1;
  }
  if (b === '(root)') {
    return 1;
  }
  return a.localeCompare(b);
}

function shouldSkipDir(relPath) {
  return relPath === auditRootRel || relPath.startsWith(`${auditRootRel}/`);
}

const scanStartedUtc = new Date().toISOString();
const stack = ['.'];
let directories = 0;
const rows = [];

while (stack.length > 0) {
  const relDir = stack.pop();
  directories += 1;
  let dirents;
  try {
    dirents = fs.readdirSync(path.join(cwd, relDir), { withFileTypes: true });
  } catch {
    continue;
  }

  dirents.sort((a, b) => a.name.localeCompare(b.name));
  const childDirs = [];

  for (const dirent of dirents) {
    const relPath = relDir === '.' ? dirent.name : `${relDir}/${dirent.name}`;

    if (dirent.isDirectory()) {
      if (!shouldSkipDir(relPath)) {
        childDirs.push(relPath);
      }
      continue;
    }

    if (!dirent.isFile()) {
      continue;
    }

    let stat;
    try {
      stat = fs.statSync(path.join(cwd, relPath));
    } catch {
      continue;
    }

    const extension = getExtension(path.basename(relPath));
    const topLevel = toTopLevel(relPath);
    const cls = classify(relPath, topLevel, extension);

    rows.push({
      path: relPath,
      top_level: topLevel,
      extension,
      size_bytes: stat.size,
      mtime_utc: stat.mtime.toISOString(),
      audit_status: cls.status,
      cleanup_action: cls.cleanup_action,
      reason: cls.reason,
    });
  }

  for (let i = childDirs.length - 1; i >= 0; i -= 1) {
    stack.push(childDirs[i]);
  }
}

rows.sort((a, b) => a.path.localeCompare(b.path));

const allCount = rows.length;
const mdRows = rows.filter((r) => r.extension === 'md');
const mdCount = mdRows.length;
const rootRows = rows.filter((r) => r.top_level === '(root)');
const rootMdRows = rootRows.filter((r) => r.extension === 'md');

const topSummary = new Map();
const extSummary = new Map();
const statusSummary = new Map();
const statusTopSummary = new Map();

for (const r of rows) {
  if (!topSummary.has(r.top_level)) {
    topSummary.set(r.top_level, { files: 0, md: 0 });
  }
  const top = topSummary.get(r.top_level);
  top.files += 1;
  if (r.extension === 'md') {
    top.md += 1;
  }

  extSummary.set(r.extension, (extSummary.get(r.extension) || 0) + 1);
  statusSummary.set(r.audit_status, (statusSummary.get(r.audit_status) || 0) + 1);

  const key = `${r.top_level}\t${r.audit_status}`;
  statusTopSummary.set(key, (statusTopSummary.get(key) || 0) + 1);
}

const topRows = [...topSummary.entries()]
  .map(([top_level, v]) => ({ top_level, files: v.files, md_files: v.md }))
  .sort((a, b) => b.files - a.files || sortTopLevel(a.top_level, b.top_level));

const extRows = [...extSummary.entries()]
  .map(([extension, files]) => ({ extension, files }))
  .sort((a, b) => b.files - a.files || a.extension.localeCompare(b.extension));

const statusRows = [...statusSummary.entries()]
  .map(([status, files]) => ({ status, files }))
  .sort((a, b) => b.files - a.files || a.status.localeCompare(b.status));

const statusTopRows = [...statusTopSummary.entries()]
  .map(([key, files]) => {
    const [top_level, status] = key.split('\t');
    return { top_level, status, files };
  })
  .sort((a, b) => sortTopLevel(a.top_level, b.top_level) || a.status.localeCompare(b.status));

const largestRows = [...rows]
  .sort((a, b) => b.size_bytes - a.size_bytes || a.path.localeCompare(b.path))
  .slice(0, 250);

const rootMdList = rootMdRows.map((r) => r.path).sort((a, b) => a.localeCompare(b));

writeTsv(
  path.join(dirSummaryAbs, 'root_files.tsv'),
  ['path', 'top_level', 'extension', 'size_bytes', 'mtime_utc', 'audit_status', 'cleanup_action', 'reason'],
  rootRows.map((r) => asTsv([
    r.path, r.top_level, r.extension, r.size_bytes, r.mtime_utc, r.audit_status, r.cleanup_action, r.reason,
  ]))
);

fs.writeFileSync(
  path.join(dirSummaryAbs, 'root_markdown_starting_set.md'),
  [
    '# Root Markdown Starting Set',
    '',
    `- Snapshot timestamp: ${scanStartedUtc}`,
    `- Root markdown count: ${rootMdList.length}`,
    '',
    '## Files',
    '',
    ...rootMdList.map((p) => `- \`${p}\``),
    '',
  ].join('\n'),
  'utf8'
);

writeTsv(
  path.join(dirSummaryAbs, 'top_level_summary.tsv'),
  ['top_level', 'files', 'md_files'],
  topRows.map((r) => asTsv([r.top_level, r.files, r.md_files]))
);

writeTsv(
  path.join(dirSummaryAbs, 'extension_distribution.tsv'),
  ['extension', 'files'],
  extRows.map((r) => asTsv([r.extension, r.files]))
);

writeTsv(
  path.join(dirSummaryAbs, 'status_counts.tsv'),
  ['audit_status', 'files'],
  statusRows.map((r) => asTsv([r.status, r.files]))
);

writeTsv(
  path.join(dirSummaryAbs, 'status_by_top_level.tsv'),
  ['top_level', 'audit_status', 'files'],
  statusTopRows.map((r) => asTsv([r.top_level, r.status, r.files]))
);

writeTsv(
  path.join(dirSummaryAbs, 'largest_files_top250.tsv'),
  ['path', 'size_bytes', 'top_level', 'extension', 'audit_status', 'cleanup_action'],
  largestRows.map((r) => asTsv([r.path, r.size_bytes, r.top_level, r.extension, r.audit_status, r.cleanup_action]))
);

const indexRows = [];

function writeChunkSet(dataset, inputRows, baseDir) {
  const groups = new Map();
  for (const row of inputRows) {
    if (!groups.has(row.top_level)) {
      groups.set(row.top_level, []);
    }
    groups.get(row.top_level).push(row);
  }

  for (const topLevel of [...groups.keys()].sort(sortTopLevel)) {
    const list = groups.get(topLevel).sort((a, b) => a.path.localeCompare(b.path));
    if (list.length <= chunkSize) {
      const fileName = `${safeSegment(topLevel)}.tsv`;
      const fileAbs = path.join(baseDir, fileName);
      writeTsv(
        fileAbs,
        ['path', 'top_level', 'extension', 'size_bytes', 'mtime_utc', 'audit_status', 'cleanup_action', 'reason'],
        list.map((r) => asTsv([
          r.path, r.top_level, r.extension, r.size_bytes, r.mtime_utc, r.audit_status, r.cleanup_action, r.reason,
        ]))
      );
      indexRows.push({
        dataset,
        chunk_file: path.join('chunks', dataset, fileName).replaceAll('\\', '/'),
        top_level: topLevel,
        part: 1,
        rows: list.length,
      });
      continue;
    }

    let offset = 0;
    let part = 1;
    while (offset < list.length) {
      const slice = list.slice(offset, offset + chunkSize);
      const fileName = `${safeSegment(topLevel)}-part-${String(part).padStart(3, '0')}.tsv`;
      const fileAbs = path.join(baseDir, fileName);
      writeTsv(
        fileAbs,
        ['path', 'top_level', 'extension', 'size_bytes', 'mtime_utc', 'audit_status', 'cleanup_action', 'reason'],
        slice.map((r) => asTsv([
          r.path, r.top_level, r.extension, r.size_bytes, r.mtime_utc, r.audit_status, r.cleanup_action, r.reason,
        ]))
      );
      indexRows.push({
        dataset,
        chunk_file: path.join('chunks', dataset, fileName).replaceAll('\\', '/'),
        top_level: topLevel,
        part,
        rows: slice.length,
      });
      offset += slice.length;
      part += 1;
    }
  }
}

writeChunkSet('md', mdRows, mdChunksAbs);
writeChunkSet('all', rows, allChunksAbs);

indexRows.sort((a, b) =>
  a.dataset.localeCompare(b.dataset) ||
  sortTopLevel(a.top_level, b.top_level) ||
  a.part - b.part
);

writeTsv(
  path.join(auditRootAbs, 'manifest_index.tsv'),
  ['dataset', 'chunk_file', 'top_level', 'part', 'rows'],
  indexRows.map((r) => asTsv([r.dataset, r.chunk_file, r.top_level, r.part, r.rows]))
);

function validateIndex() {
  let chunkRowsAll = 0;
  let chunkRowsMd = 0;
  const problems = [];

  for (const row of indexRows) {
    const abs = path.join(auditRootAbs, row.chunk_file);
    if (!fs.existsSync(abs)) {
      problems.push(`Missing chunk: ${row.chunk_file}`);
      continue;
    }
    const fileLines = fs.readFileSync(abs, 'utf8').split('\n').filter(Boolean);
    const dataCount = Math.max(0, fileLines.length - 1);
    if (dataCount !== row.rows) {
      problems.push(`Row mismatch ${row.chunk_file}: expected ${row.rows}, got ${dataCount}`);
    }
    if (row.dataset === 'all') {
      chunkRowsAll += dataCount;
    } else if (row.dataset === 'md') {
      chunkRowsMd += dataCount;
    }
  }

  return {
    problems,
    chunkRowsAll,
    chunkRowsMd,
  };
}

const validations = validateIndex();
const uniquePathCount = new Set(rows.map((r) => r.path)).size;
const top4 = topRows.slice(0, 4);

const statusMap = new Map(statusRows.map((r) => [r.status, r.files]));
const statusNow = statusMap.get('REAUDIT_NOW') || 0;
const statusLater = statusMap.get('REAUDIT_LATER') || 0;
const statusExcluded = statusMap.get('EXCLUDE_RUNTIME_ARTIFACT') || 0;

const report = [
  '# Complete File Audit',
  '',
  `- Generated at (UTC): **${scanStartedUtc}**`,
  `- Scope: **entire workspace on disk** (excluding self-generated audit folder \`${auditRootRel}/\`)`,
  `- Total files: **${allCount.toLocaleString('en-US')}**`,
  `- Total directories: **${directories.toLocaleString('en-US')}**`,
  `- Markdown files: **${mdCount.toLocaleString('en-US')}**`,
  `- Root files: **${rootRows.length.toLocaleString('en-US')}**`,
  `- Root markdown files: **${rootMdRows.length.toLocaleString('en-US')}**`,
  '',
  '## Largest Top-Level Directories',
  '',
  ...top4.map((x) => `- \`${x.top_level}\`: ${x.files.toLocaleString('en-US')} files (${x.md_files.toLocaleString('en-US')} markdown)`),
  '',
  '## Audit Status Totals',
  '',
  `- \`REAUDIT_NOW\`: **${statusNow.toLocaleString('en-US')}**`,
  `- \`REAUDIT_LATER\`: **${statusLater.toLocaleString('en-US')}**`,
  `- \`EXCLUDE_RUNTIME_ARTIFACT\`: **${statusExcluded.toLocaleString('en-US')}**`,
  '',
  '## Validation',
  '',
  `- Coverage parity (chunks/all): ${validations.chunkRowsAll === allCount ? 'PASS' : 'FAIL'} (${validations.chunkRowsAll} vs ${allCount})`,
  `- Markdown parity (chunks/md): ${validations.chunkRowsMd === mdCount ? 'PASS' : 'FAIL'} (${validations.chunkRowsMd} vs ${mdCount})`,
  `- Uniqueness: ${uniquePathCount === allCount ? 'PASS' : 'FAIL'} (${uniquePathCount} unique paths)`,
  `- Chunk integrity: ${validations.problems.length === 0 ? 'PASS' : 'FAIL'} (${validations.problems.length} issues)`,
  '',
  '## Output Artifacts',
  '',
  `- Summary report: \`docs/development/COMPLETE_FILE_AUDIT.md\``,
  `- Chunk index: \`${auditRootRel}/manifest_index.tsv\``,
  `- All-file chunks: \`${auditRootRel}/chunks/all/\``,
  `- Markdown chunks: \`${auditRootRel}/chunks/md/\``,
  `- Top-level summary: \`${auditRootRel}/summaries/top_level_summary.tsv\``,
  `- Extension distribution: \`${auditRootRel}/summaries/extension_distribution.tsv\``,
  `- Status totals: \`${auditRootRel}/summaries/status_counts.tsv\``,
  `- Status by top-level: \`${auditRootRel}/summaries/status_by_top_level.tsv\``,
  `- Largest files (top 250): \`${auditRootRel}/summaries/largest_files_top250.tsv\``,
  `- Root files: \`${auditRootRel}/summaries/root_files.tsv\``,
  `- Root markdown set: \`${auditRootRel}/summaries/root_markdown_starting_set.md\``,
  '',
];

if (validations.problems.length > 0) {
  report.push('## Validation Problems');
  report.push('');
  for (const issue of validations.problems.slice(0, 100)) {
    report.push(`- ${issue}`);
  }
  report.push('');
}

fs.writeFileSync(reportAbs, report.join('\n'), 'utf8');

console.log(JSON.stringify({
  generated_at: scanStartedUtc,
  report: path.relative(cwd, reportAbs),
  audit_root: auditRootRel,
  totals: {
    files: allCount,
    directories,
    markdown: mdCount,
    root_files: rootRows.length,
    root_markdown: rootMdRows.length,
  },
  status: {
    REAUDIT_NOW: statusNow,
    REAUDIT_LATER: statusLater,
    EXCLUDE_RUNTIME_ARTIFACT: statusExcluded,
  },
  chunks: {
    all: indexRows.filter((r) => r.dataset === 'all').length,
    md: indexRows.filter((r) => r.dataset === 'md').length,
  },
  validation: {
    coverage_parity: validations.chunkRowsAll === allCount,
    markdown_parity: validations.chunkRowsMd === mdCount,
    uniqueness: uniquePathCount === allCount,
    chunk_integrity: validations.problems.length === 0,
    issues: validations.problems.length,
  },
}, null, 2));
