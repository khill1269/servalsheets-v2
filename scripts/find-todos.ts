#!/usr/bin/env tsx
/**
 * Find TODO and FIXME comments in documentation
 * Helps identify incomplete or placeholder content
 */

import fs from 'node:fs';
import { glob } from 'glob';

interface TodoItem {
  file: string;
  line: number;
  type: 'TODO' | 'FIXME';
  text: string;
  context: string;
}

async function findTodos(): Promise<TodoItem[]> {
  const files = await glob('docs/**/*.md', {
    ignore: [
      '**/node_modules/**',
      '**/docs/.vitepress/**',
      '**/docs/.templates/**',
      '**/docs/archive/**',
    ],
  });

  const todos: TodoItem[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const todoMatch = line.match(/\bTODO\b:?\s*(.*)/i);
      const fixmeMatch = line.match(/\bFIXME\b:?\s*(.*)/i);

      if (todoMatch) {
        todos.push({
          file,
          line: i + 1,
          type: 'TODO',
          text: todoMatch[1].trim() || '(no description)',
          context: line.trim(),
        });
      }

      if (fixmeMatch) {
        todos.push({
          file,
          line: i + 1,
          type: 'FIXME',
          text: fixmeMatch[1].trim() || '(no description)',
          context: line.trim(),
        });
      }
    }
  }

  return todos;
}

async function main() {
  console.log('🔍 Searching for TODO and FIXME comments...\n');

  const todos = await findTodos();

  if (todos.length === 0) {
    console.log('✅ No TODO or FIXME comments found!\n');
    return;
  }

  console.log(`Found ${todos.length} items:\n`);

  // Group by file
  const byFile = new Map<string, TodoItem[]>();
  for (const todo of todos) {
    const relPath = todo.file.replace('docs/', '');
    if (!byFile.has(relPath)) {
      byFile.set(relPath, []);
    }
    byFile.get(relPath)!.push(todo);
  }

  // Sort by file with most TODOs first
  const sorted = Array.from(byFile.entries()).sort((a, b) => b[1].length - a[1].length);

  for (const [file, items] of sorted) {
    console.log(`📄 ${file} (${items.length} items)`);
    for (const item of items) {
      const icon = item.type === 'TODO' ? '📋' : '🔧';
      console.log(`   ${icon} Line ${item.line}: ${item.text}`);
      if (item.text === '(no description)') {
        console.log(`      Context: ${item.context.slice(0, 80)}...`);
      }
    }
    console.log();
  }

  console.log('💡 Action items:');
  console.log('   1. Review each TODO/FIXME');
  console.log('   2. Complete the work or create GitHub issues');
  console.log('   3. Remove the comment once done');
  console.log();
}

main().catch(console.error);
