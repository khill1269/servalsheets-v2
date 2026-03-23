#!/usr/bin/env tsx
/**
 * Check external links in markdown files
 * Usage: tsx scripts/check-external-links.ts [--fix] [--timeout=5000]
 */

import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import { glob } from 'glob';

const FIX_MODE = process.argv.includes('--fix');
const TIMEOUT = parseInt(
  process.argv.find((arg) => arg.startsWith('--timeout='))?.split('=')[1] || '5000',
  10
);
const DRY_RUN = process.argv.includes('--dry-run');

interface LinkCheck {
  file: string;
  line: number;
  url: string;
  status: 'valid' | 'broken' | 'timeout' | 'redirect' | 'error';
  statusCode?: number;
  redirectUrl?: string;
  error?: string;
}

const SKIP_DOMAINS = ['localhost', '127.0.0.1', '0.0.0.0', 'example.com', 'example.org'];

const urlCache = new Map<string, LinkCheck>();

function extractLinks(content: string, filePath: string): LinkCheck[] {
  const links: LinkCheck[] = [];
  const lines = content.split('\n');

  // Match markdown links [text](url) and bare URLs starting with http
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)|(?:^|[^"])(https?:\/\/[^\s<>"]+)/gm;

  lines.forEach((line, index) => {
    let match;
    while ((match = linkRegex.exec(line)) !== null) {
      const url = match[2] || match[3]; // match[2] for markdown links, match[3] for bare URLs

      if (!url || url.startsWith('#') || url.startsWith('/')) {
        continue; // Skip anchors and relative paths
      }

      try {
        const parsedUrl = new URL(url);

        // Skip excluded domains
        if (SKIP_DOMAINS.some((domain) => parsedUrl.hostname.includes(domain))) {
          continue;
        }

        links.push({
          file: filePath,
          line: index + 1,
          url,
          status: 'valid', // Will be updated by checkUrl
        });
      } catch {
        // Invalid URL, skip
      }
    }
  });

  return links;
}

function checkUrl(url: string): Promise<LinkCheck> {
  // Check cache first
  if (urlCache.has(url)) {
    return Promise.resolve({ ...urlCache.get(url)!, url });
  }

  return new Promise((resolve) => {
    try {
      const parsedUrl = new URL(url);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;

      const req = protocol.request(
        url,
        {
          method: 'HEAD',
          timeout: TIMEOUT,
          headers: {
            'User-Agent': 'ServalSheets-Link-Checker/1.0',
          },
        },
        (res) => {
          const result: LinkCheck = {
            file: '',
            line: 0,
            url,
            status: 'valid',
            statusCode: res.statusCode,
          };

          if (res.statusCode) {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              result.status = 'valid';
            } else if (res.statusCode >= 300 && res.statusCode < 400) {
              result.status = 'redirect';
              result.redirectUrl = res.headers.location;
            } else if (res.statusCode >= 400) {
              result.status = 'broken';
            }
          }

          urlCache.set(url, result);
          resolve(result);
        }
      );

      req.on('timeout', () => {
        req.destroy();
        const result: LinkCheck = {
          file: '',
          line: 0,
          url,
          status: 'timeout',
        };
        urlCache.set(url, result);
        resolve(result);
      });

      req.on('error', (err) => {
        const result: LinkCheck = {
          file: '',
          line: 0,
          url,
          status: 'error',
          error: err.message,
        };
        urlCache.set(url, result);
        resolve(result);
      });

      req.end();
    } catch (err) {
      const result: LinkCheck = {
        file: '',
        line: 0,
        url,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      };
      resolve(result);
    }
  });
}

async function processFile(filePath: string): Promise<LinkCheck[]> {
  const content = fs.readFileSync(filePath, 'utf8');
  const links = extractLinks(content, filePath);

  // Check each unique URL
  const uniqueUrls = [...new Set(links.map((l) => l.url))];
  const checks = await Promise.all(uniqueUrls.map((url) => checkUrl(url)));

  // Merge results back into links
  return links.map((link) => {
    const check = checks.find((c) => c.url === link.url);
    return { ...link, ...check };
  });
}

async function main() {
  console.log('🔍 Checking external links in markdown files...\n');

  const pattern = 'docs/**/*.md';
  const files = await glob(pattern, {
    ignore: ['**/node_modules/**', '**/docs/.vitepress/**', '**/docs/archive/**'],
  });

  console.log(`Found ${files.length} markdown files\n`);

  const allChecks: LinkCheck[] = [];

  for (const file of files) {
    process.stdout.write(`Checking ${file}...`);
    const checks = await processFile(file);
    allChecks.push(...checks);

    const broken = checks.filter((c) => c.status === 'broken' || c.status === 'error');
    if (broken.length > 0) {
      console.log(` ❌ ${broken.length} broken`);
    } else {
      console.log(' ✅');
    }
  }

  // Summary
  console.log('\n📊 Summary:\n');

  const grouped = {
    valid: allChecks.filter((c) => c.status === 'valid'),
    broken: allChecks.filter((c) => c.status === 'broken'),
    error: allChecks.filter((c) => c.status === 'error'),
    timeout: allChecks.filter((c) => c.status === 'timeout'),
    redirect: allChecks.filter((c) => c.status === 'redirect'),
  };

  console.log(`✅ Valid: ${grouped.valid.length}`);
  console.log(`❌ Broken: ${grouped.broken.length}`);
  console.log(`⚠️  Errors: ${grouped.error.length}`);
  console.log(`⏱️  Timeouts: ${grouped.timeout.length}`);
  console.log(`🔀 Redirects: ${grouped.redirect.length}`);

  // Show details for problematic links
  if (grouped.broken.length > 0) {
    console.log('\n❌ Broken Links:\n');
    grouped.broken.forEach((check) => {
      console.log(`  ${check.file}:${check.line}`);
      console.log(`    ${check.url} (${check.statusCode})`);
    });
  }

  if (grouped.error.length > 0) {
    console.log('\n⚠️  Error Links:\n');
    grouped.error.forEach((check) => {
      console.log(`  ${check.file}:${check.line}`);
      console.log(`    ${check.url}`);
      console.log(`    Error: ${check.error}`);
    });
  }

  if (grouped.timeout.length > 0) {
    console.log('\n⏱️  Timeout Links (may be valid but slow):\n');
    grouped.timeout.forEach((check) => {
      console.log(`  ${check.file}:${check.line}`);
      console.log(`    ${check.url}`);
    });
  }

  if (grouped.redirect.length > 0 && FIX_MODE) {
    console.log('\n🔀 Redirects (use --fix to update):\n');
    grouped.redirect.forEach((check) => {
      console.log(`  ${check.file}:${check.line}`);
      console.log(`    ${check.url} → ${check.redirectUrl}`);
    });
  }

  // Exit code
  const hasErrors = grouped.broken.length + grouped.error.length > 0;
  if (hasErrors) {
    console.log('\n💡 Tip: Some links may be temporarily down. Run again to verify.');
    process.exit(1);
  }

  console.log('\n✨ All external links are valid!');
}

main().catch(console.error);
