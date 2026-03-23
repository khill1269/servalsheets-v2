#!/usr/bin/env tsx
/**
 * Deep documentation analysis - identify optimization opportunities
 * Checks structure, consistency, quality, and completeness
 */

import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { glob } from 'glob';

interface DocAnalysis {
  file: string;
  size: number;
  lines: number;
  words: number;
  issues: Issue[];
  metadata: DocMetadata;
  structure: StructureAnalysis;
  quality: QualityMetrics;
}

interface Issue {
  type: 'error' | 'warning' | 'info';
  category: string;
  message: string;
  line?: number;
}

interface DocMetadata {
  hasFrontmatter: boolean;
  title?: string;
  description?: string;
  category?: string;
  tags?: string[];
  lastUpdated?: string;
  missingFields: string[];
}

interface StructureAnalysis {
  hasH1: boolean;
  h1Count: number;
  h1Text?: string;
  headingStructure: string[];
  maxHeadingDepth: number;
  hasCodeBlocks: boolean;
  codeBlockCount: number;
  hasLinks: boolean;
  linkCount: number;
  hasTables: boolean;
  tableCount: number;
  hasImages: boolean;
  imageCount: number;
  hasTODO: boolean;
  hasFixme: boolean;
}

interface QualityMetrics {
  avgWordsPerSentence: number;
  avgSentencesPerParagraph: number;
  readabilityScore: number;
  hasExamples: boolean;
  hasTroubleshooting: boolean;
  hasPrerequisites: boolean;
  longLines: number[];
  duplicateHeadings: string[];
  brokenAnchors: string[];
}

function parseFrontmatter(content: string): DocMetadata {
  const metadata: DocMetadata = {
    hasFrontmatter: false,
    missingFields: [],
  };

  if (!content.trimStart().startsWith('---')) {
    metadata.missingFields = ['frontmatter'];
    return metadata;
  }

  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return metadata;
  }

  metadata.hasFrontmatter = true;
  const frontmatterStr = content.slice(3, endIndex).trim();

  // Parse YAML-like frontmatter
  const lines = frontmatterStr.split('\n');
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value: string | string[] = line.slice(colonIndex + 1).trim();

    if (value.startsWith('[') && value.endsWith(']')) {
      value = value
        .slice(1, -1)
        .split(',')
        .map((v) => v.trim().replace(/^["']|["']$/g, ''));
    } else {
      value = value.replace(/^["']|["']$/g, '');
    }

    switch (key) {
      case 'title':
        metadata.title = value as string;
        break;
      case 'description':
        metadata.description = value as string;
        break;
      case 'category':
        metadata.category = value as string;
        break;
      case 'tags':
        metadata.tags = Array.isArray(value) ? value : [value];
        break;
      case 'last_updated':
        metadata.lastUpdated = value as string;
        break;
    }
  }

  // Check for missing required fields
  const requiredFields = ['title', 'category', 'last_updated'];
  for (const field of requiredFields) {
    if (!metadata[field as keyof DocMetadata]) {
      metadata.missingFields.push(field);
    }
  }

  return metadata;
}

function analyzeStructure(content: string): StructureAnalysis {
  const structure: StructureAnalysis = {
    hasH1: false,
    h1Count: 0,
    headingStructure: [],
    maxHeadingDepth: 0,
    hasCodeBlocks: false,
    codeBlockCount: 0,
    hasLinks: false,
    linkCount: 0,
    hasTables: false,
    tableCount: 0,
    hasImages: false,
    imageCount: 0,
    hasTODO: false,
    hasFixme: false,
  };

  const lines = content.split('\n');

  for (const line of lines) {
    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      structure.headingStructure.push(`${'  '.repeat(level - 1)}H${level}: ${text}`);
      structure.maxHeadingDepth = Math.max(structure.maxHeadingDepth, level);

      if (level === 1) {
        structure.hasH1 = true;
        structure.h1Count++;
        if (!structure.h1Text) {
          structure.h1Text = text;
        }
      }
    }

    // Code blocks
    if (line.trim().startsWith('```')) {
      structure.hasCodeBlocks = true;
      structure.codeBlockCount++;
    }

    // Links
    const linkMatches = line.match(/\[([^\]]+)\]\(([^)]+)\)/g);
    if (linkMatches) {
      structure.hasLinks = true;
      structure.linkCount += linkMatches.length;
    }

    // Tables
    if (line.includes('|')) {
      structure.hasTables = true;
      structure.tableCount++;
    }

    // Images
    if (line.match(/!\[([^\]]*)\]\(([^)]+)\)/)) {
      structure.hasImages = true;
      structure.imageCount++;
    }

    // TODO/FIXME
    if (line.match(/\bTODO\b/i)) {
      structure.hasTODO = true;
    }
    if (line.match(/\bFIXME\b/i)) {
      structure.hasFixme = true;
    }
  }

  return structure;
}

function analyzeQuality(content: string): QualityMetrics {
  const quality: QualityMetrics = {
    avgWordsPerSentence: 0,
    avgSentencesPerParagraph: 0,
    readabilityScore: 0,
    hasExamples: false,
    hasTroubleshooting: false,
    hasPrerequisites: false,
    longLines: [],
    duplicateHeadings: [],
    brokenAnchors: [],
  };

  // Remove frontmatter and code blocks for text analysis
  let text = content;
  if (content.trimStart().startsWith('---')) {
    const endIndex = content.indexOf('---', 3);
    if (endIndex !== -1) {
      text = content.slice(endIndex + 3);
    }
  }
  text = text.replace(/```[\s\S]*?```/g, '');

  // Check for key sections
  quality.hasExamples = /##?\s+(Example|Examples|Usage)/i.test(content);
  quality.hasTroubleshooting = /##?\s+Troubleshooting/i.test(content);
  quality.hasPrerequisites = /##?\s+Prerequisites/i.test(content);

  // Find long lines (>120 chars, excluding code/links)
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      line.length > 120 &&
      !line.trim().startsWith('```') &&
      !line.trim().startsWith('|') &&
      !line.includes('http')
    ) {
      quality.longLines.push(i + 1);
    }
  }

  // Find duplicate headings
  const headings = content.match(/^#{1,6}\s+(.+)$/gm) || [];
  const headingTexts = headings.map((h) => h.replace(/^#+\s+/, '').trim());
  const seen = new Set<string>();
  for (const heading of headingTexts) {
    if (seen.has(heading)) {
      quality.duplicateHeadings.push(heading);
    }
    seen.add(heading);
  }

  // Simple readability (Flesch reading ease approximation)
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const syllables = words.reduce((sum, word) => sum + estimateSyllables(word), 0);

  if (sentences.length > 0 && words.length > 0) {
    quality.avgWordsPerSentence = words.length / sentences.length;
    quality.readabilityScore = Math.max(
      0,
      206.835 - 1.015 * quality.avgWordsPerSentence - 84.6 * (syllables / words.length)
    );
  }

  return quality;
}

function estimateSyllables(word: string): number {
  word = word.toLowerCase().replace(/[^a-z]/g, '');
  if (word.length <= 3) return 1;

  const vowels = word.match(/[aeiouy]+/g);
  let count = vowels ? vowels.length : 1;

  // Adjustments
  if (word.endsWith('e')) count--;
  if (word.endsWith('le') && word.length > 2) count++;
  if (count === 0) count = 1;

  return count;
}

function findIssues(analysis: DocAnalysis): Issue[] {
  const issues: Issue[] = [];

  // Metadata issues
  if (!analysis.metadata.hasFrontmatter) {
    issues.push({
      type: 'error',
      category: 'metadata',
      message: 'Missing frontmatter block',
    });
  }

  for (const field of analysis.metadata.missingFields) {
    issues.push({
      type: 'warning',
      category: 'metadata',
      message: `Missing required frontmatter field: ${field}`,
    });
  }

  if (!analysis.metadata.description) {
    issues.push({
      type: 'info',
      category: 'metadata',
      message: 'Missing description (helpful for search)',
    });
  }

  if (!analysis.metadata.tags || analysis.metadata.tags.length === 0) {
    issues.push({
      type: 'info',
      category: 'metadata',
      message: 'No tags (reduces discoverability)',
    });
  }

  // Structure issues
  if (!analysis.structure.hasH1) {
    issues.push({
      type: 'error',
      category: 'structure',
      message: 'Missing H1 heading',
    });
  }

  if (analysis.structure.h1Count > 1) {
    issues.push({
      type: 'warning',
      category: 'structure',
      message: `Multiple H1 headings (${analysis.structure.h1Count})`,
    });
  }

  if (analysis.structure.hasTODO) {
    issues.push({
      type: 'warning',
      category: 'content',
      message: 'Contains TODO comments',
    });
  }

  if (analysis.structure.hasFixme) {
    issues.push({
      type: 'warning',
      category: 'content',
      message: 'Contains FIXME comments',
    });
  }

  // Size issues
  if (analysis.words < 50) {
    issues.push({
      type: 'warning',
      category: 'content',
      message: 'Very short document (< 50 words)',
    });
  }

  if (analysis.words > 5000) {
    issues.push({
      type: 'info',
      category: 'content',
      message: 'Very long document (> 5000 words) - consider splitting',
    });
  }

  // Quality issues
  if (analysis.quality.longLines.length > 0) {
    issues.push({
      type: 'info',
      category: 'formatting',
      message: `${analysis.quality.longLines.length} lines exceed 120 characters`,
    });
  }

  if (analysis.quality.duplicateHeadings.length > 0) {
    issues.push({
      type: 'warning',
      category: 'structure',
      message: `Duplicate headings: ${[...new Set(analysis.quality.duplicateHeadings)].join(', ')}`,
    });
  }

  if (analysis.quality.readabilityScore < 30) {
    issues.push({
      type: 'info',
      category: 'readability',
      message: 'Complex/difficult text (low readability score)',
    });
  }

  if (analysis.structure.hasCodeBlocks && !analysis.quality.hasExamples) {
    issues.push({
      type: 'info',
      category: 'content',
      message: 'Has code but no "Examples" section heading',
    });
  }

  // Consistency checks
  if (
    analysis.metadata.title &&
    analysis.structure.h1Text &&
    analysis.metadata.title !== analysis.structure.h1Text
  ) {
    issues.push({
      type: 'warning',
      category: 'consistency',
      message: `Frontmatter title doesn't match H1: "${analysis.metadata.title}" vs "${analysis.structure.h1Text}"`,
    });
  }

  return issues;
}

async function analyzeFile(file: string): Promise<DocAnalysis> {
  const content = readFileSync(file, 'utf8');
  const stats = statSync(file);

  const words = content.split(/\s+/).filter((w) => w.length > 0).length;
  const lines = content.split('\n').length;

  const metadata = parseFrontmatter(content);
  const structure = analyzeStructure(content);
  const quality = analyzeQuality(content);

  const analysis: DocAnalysis = {
    file,
    size: stats.size,
    lines,
    words,
    metadata,
    structure,
    quality,
    issues: [],
  };

  analysis.issues = findIssues(analysis);

  return analysis;
}

function generateReport(analyses: DocAnalysis[]): void {
  console.log('\n📊 Deep Documentation Analysis Report\n');
  console.log('═'.repeat(80));

  // Overall stats
  const totalFiles = analyses.length;
  const totalWords = analyses.reduce((sum, a) => sum + a.words, 0);
  const totalIssues = analyses.reduce((sum, a) => sum + a.issues.length, 0);
  const filesWithIssues = analyses.filter((a) => a.issues.length > 0).length;

  console.log('\n📈 Overall Statistics:\n');
  console.log(`  Total files analyzed: ${totalFiles}`);
  console.log(`  Total words: ${totalWords.toLocaleString()}`);
  console.log(`  Average words per doc: ${Math.round(totalWords / totalFiles)}`);
  console.log(
    `  Files with issues: ${filesWithIssues} (${((filesWithIssues / totalFiles) * 100).toFixed(1)}%)`
  );
  console.log(`  Total issues found: ${totalIssues}`);

  // Issue breakdown
  const issuesByType = {
    error: 0,
    warning: 0,
    info: 0,
  };
  const issuesByCategory = new Map<string, number>();

  for (const analysis of analyses) {
    for (const issue of analysis.issues) {
      issuesByType[issue.type]++;
      issuesByCategory.set(issue.category, (issuesByCategory.get(issue.category) || 0) + 1);
    }
  }

  console.log('\n🔍 Issues by Severity:\n');
  console.log(`  🚨 Errors: ${issuesByType.error}`);
  console.log(`  ⚠️  Warnings: ${issuesByType.warning}`);
  console.log(`  ℹ️  Info: ${issuesByType.info}`);

  console.log('\n📂 Issues by Category:\n');
  const sortedCategories = Array.from(issuesByCategory.entries()).sort((a, b) => b[1] - a[1]);
  for (const [category, count] of sortedCategories) {
    console.log(`  ${category}: ${count}`);
  }

  // Top issues
  console.log('\n🔴 Files with Most Issues (Top 10):\n');
  const sortedByIssues = [...analyses]
    .sort((a, b) => b.issues.length - a.issues.length)
    .slice(0, 10);

  for (const analysis of sortedByIssues) {
    if (analysis.issues.length === 0) break;
    const relPath = relative('docs', analysis.file);
    console.log(`  ${relPath}: ${analysis.issues.length} issues`);

    for (const issue of analysis.issues.slice(0, 3)) {
      const icon = issue.type === 'error' ? '🚨' : issue.type === 'warning' ? '⚠️' : 'ℹ️';
      console.log(`    ${icon} ${issue.message}`);
    }
    if (analysis.issues.length > 3) {
      console.log(`    ... and ${analysis.issues.length - 3} more`);
    }
  }

  // Structure insights
  const withCodeBlocks = analyses.filter((a) => a.structure.hasCodeBlocks).length;
  const withExamples = analyses.filter((a) => a.quality.hasExamples).length;
  const withTroubleshooting = analyses.filter((a) => a.quality.hasTroubleshooting).length;
  const withPrerequisites = analyses.filter((a) => a.quality.hasPrerequisites).length;

  console.log('\n📝 Content Features:\n');
  console.log(
    `  With code blocks: ${withCodeBlocks} (${((withCodeBlocks / totalFiles) * 100).toFixed(1)}%)`
  );
  console.log(
    `  With examples section: ${withExamples} (${((withExamples / totalFiles) * 100).toFixed(1)}%)`
  );
  console.log(
    `  With troubleshooting: ${withTroubleshooting} (${((withTroubleshooting / totalFiles) * 100).toFixed(1)}%)`
  );
  console.log(
    `  With prerequisites: ${withPrerequisites} (${((withPrerequisites / totalFiles) * 100).toFixed(1)}%)`
  );

  // Readability
  const avgReadability =
    analyses.reduce((sum, a) => sum + a.quality.readabilityScore, 0) / analyses.length;
  console.log('\n📖 Readability:\n');
  console.log(`  Average readability score: ${avgReadability.toFixed(1)}`);
  console.log('  (60-70 = Standard, 50-60 = Fairly difficult, <50 = Difficult)');

  // Size distribution
  const sizeBuckets = {
    tiny: analyses.filter((a) => a.words < 100).length,
    small: analyses.filter((a) => a.words >= 100 && a.words < 500).length,
    medium: analyses.filter((a) => a.words >= 500 && a.words < 2000).length,
    large: analyses.filter((a) => a.words >= 2000 && a.words < 5000).length,
    huge: analyses.filter((a) => a.words >= 5000).length,
  };

  console.log('\n📏 Document Size Distribution:\n');
  console.log(`  Tiny (< 100 words): ${sizeBuckets.tiny}`);
  console.log(`  Small (100-500): ${sizeBuckets.small}`);
  console.log(`  Medium (500-2000): ${sizeBuckets.medium}`);
  console.log(`  Large (2000-5000): ${sizeBuckets.large}`);
  console.log(`  Huge (> 5000): ${sizeBuckets.huge}`);

  // Actionable recommendations
  console.log('\n💡 Recommendations:\n');

  const priorities: string[] = [];

  if (issuesByType.error > 0) {
    priorities.push(`🚨 Fix ${issuesByType.error} critical errors (missing H1, frontmatter)`);
  }

  const missingDescriptions = analyses.filter((a) => !a.metadata.description).length;
  if (missingDescriptions > 10) {
    priorities.push(`⚠️  Add descriptions to ${missingDescriptions} docs (improves search)`);
  }

  const missingTags = analyses.filter(
    (a) => !a.metadata.tags || a.metadata.tags.length === 0
  ).length;
  if (missingTags > 10) {
    priorities.push(`ℹ️  Add tags to ${missingTags} docs (improves discoverability)`);
  }

  const withTodos = analyses.filter((a) => a.structure.hasTODO || a.structure.hasFixme).length;
  if (withTodos > 0) {
    priorities.push(`📋 Address TODO/FIXME in ${withTodos} docs`);
  }

  const hugeDocs = analyses.filter((a) => a.words > 5000);
  if (hugeDocs.length > 0) {
    priorities.push(`✂️  Consider splitting ${hugeDocs.length} very long docs`);
  }

  const codeWithoutExamples = analyses.filter(
    (a) => a.structure.hasCodeBlocks && !a.quality.hasExamples
  ).length;
  if (codeWithoutExamples > 5) {
    priorities.push(`📚 Add "Examples" section to ${codeWithoutExamples} docs with code`);
  }

  if (priorities.length === 0) {
    console.log('  ✅ Documentation is in excellent shape!');
  } else {
    for (let i = 0; i < Math.min(priorities.length, 5); i++) {
      console.log(`  ${i + 1}. ${priorities[i]}`);
    }
  }

  console.log('\n' + '═'.repeat(80) + '\n');
}

async function main() {
  console.log('🔬 Running deep documentation analysis...');

  const files = await glob('docs/**/*.md', {
    ignore: [
      '**/node_modules/**',
      '**/docs/.vitepress/**',
      '**/docs/.templates/**',
      '**/docs/archive/**',
      '**/docs/DOCS_CATALOG.md',
      '**/docs/METRICS_DASHBOARD.md',
    ],
  });

  console.log(`Found ${files.length} documents to analyze...\n`);

  const analyses: DocAnalysis[] = [];

  for (const file of files) {
    try {
      const analysis = await analyzeFile(file);
      analyses.push(analysis);
    } catch (error) {
      console.error(`Error analyzing ${file}:`, error);
    }
  }

  generateReport(analyses);

  // Output JSON if requested
  if (process.argv.includes('--json')) {
    const outputPath =
      process.argv.find((arg) => arg.startsWith('--output='))?.split('=')[1] ||
      'docs-analysis.json';

    writeFileSync(
      outputPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          totalFiles: analyses.length,
          analyses: analyses.map((a) => ({
            file: a.file,
            words: a.words,
            issues: a.issues,
            metadata: a.metadata,
          })),
        },
        null,
        2
      )
    );

    console.log(`\n📄 Detailed analysis saved to: ${outputPath}`);
  }
}

main().catch(console.error);
