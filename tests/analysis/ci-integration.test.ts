/**
 * CI Integration Tests
 *
 * Tests the GitHub Actions workflow integration.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

describe('CI Integration', () => {
  const workflowPath = path.join(__dirname, '../../.github/workflows/multi-agent-analysis.yml');

  describe('Workflow File', () => {
    it('should exist', () => {
      expect(fs.existsSync(workflowPath)).toBe(true);
    });

    it('should be valid YAML', () => {
      const content = fs.readFileSync(workflowPath, 'utf-8');

      expect(() => yaml.parse(content)).not.toThrow();
    });

    it('should have correct name', () => {
      const content = fs.readFileSync(workflowPath, 'utf-8');
      const workflow = yaml.parse(content);

      expect(workflow.name).toBe('Multi-Agent Analysis');
    });

    it('should trigger on push and pull_request', () => {
      const content = fs.readFileSync(workflowPath, 'utf-8');
      const workflow = yaml.parse(content);

      expect(workflow.on).toBeDefined();
      expect(workflow.on.push).toBeDefined();
      expect(workflow.on.pull_request).toBeDefined();
    });

    it('should have analyze job', () => {
      const content = fs.readFileSync(workflowPath, 'utf-8');
      const workflow = yaml.parse(content);

      expect(workflow.jobs).toBeDefined();
      expect(workflow.jobs.analyze).toBeDefined();
    });

    it('should run on ubuntu-latest', () => {
      const content = fs.readFileSync(workflowPath, 'utf-8');
      const workflow = yaml.parse(content);

      expect(workflow.jobs.analyze['runs-on']).toBe('ubuntu-latest');
    });

    it('should checkout code', () => {
      const content = fs.readFileSync(workflowPath, 'utf-8');
      const workflow = yaml.parse(content);

      const steps = workflow.jobs.analyze.steps;
      const checkoutStep = steps.find((s: any) => s.uses?.includes('checkout'));

      expect(checkoutStep).toBeDefined();
    });

    it('should setup Node.js', () => {
      const content = fs.readFileSync(workflowPath, 'utf-8');
      const workflow = yaml.parse(content);

      const steps = workflow.jobs.analyze.steps;
      const nodeStep = steps.find((s: any) => s.uses?.includes('setup-node'));

      expect(nodeStep).toBeDefined();
      expect(nodeStep.with['node-version']).toBe('20');
    });

    it('should install dependencies', () => {
      const content = fs.readFileSync(workflowPath, 'utf-8');
      const workflow = yaml.parse(content);

      const steps = workflow.jobs.analyze.steps;
      const installStep = steps.find((s: any) => s.run?.includes('npm ci'));

      expect(installStep).toBeDefined();
    });

    it('should run multi-agent analysis', () => {
      const content = fs.readFileSync(workflowPath, 'utf-8');
      const workflow = yaml.parse(content);

      const steps = workflow.jobs.analyze.steps;
      const analysisStep = steps.find((s: any) => s.name?.includes('Analysis'));

      expect(analysisStep).toBeDefined();
      expect(analysisStep.run).toContain('analysis');
    });

    it('should generate reports', () => {
      const content = fs.readFileSync(workflowPath, 'utf-8');
      const workflow = yaml.parse(content);

      const steps = workflow.jobs.analyze.steps;
      const reportStep = steps.find((s: any) => s.name?.includes('Generate Report'));

      expect(reportStep).toBeDefined();
      expect(reportStep.run).toContain('report-generator');
    });

    it('should upload artifacts', () => {
      const content = fs.readFileSync(workflowPath, 'utf-8');
      const workflow = yaml.parse(content);

      const steps = workflow.jobs.analyze.steps;
      const uploadStep = steps.find((s: any) => s.uses?.includes('upload-artifact'));

      expect(uploadStep).toBeDefined();
      expect(uploadStep.with.path).toBeDefined();
    });
  });

  describe('VS Code Tasks', () => {
    const tasksPath = path.join(__dirname, '../../.vscode/tasks.json');
    const gitignorePath = path.join(__dirname, '../../.gitignore');

    it('should treat tasks.json as optional local tooling', () => {
      if (fs.existsSync(tasksPath)) {
        const content = fs.readFileSync(tasksPath, 'utf-8');
        const tasks = JSON.parse(content);
        const labels = tasks.tasks.map((t: any) => t.label);

        expect(Array.isArray(tasks.tasks)).toBe(true);
        // Check for tasks related to analysis/fixing/watching (exact match not required due to emoji prefixes)
        expect(labels.some((l: string) => l.includes('Analysis'))).toBe(true);
        expect(labels.some((l: string) => l.includes('Auto-Fix') || l.includes('Auto'))).toBe(true);
        expect(labels.some((l: string) => l.includes('Watch'))).toBe(true);
        expect(labels.some((l: string) => l.includes('Report'))).toBe(true);
        expect(labels.some((l: string) => l.includes('Changed'))).toBe(true);
        return;
      }

      const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
      expect(gitignore).toContain('.vscode/');
    });
  });

  describe('NPM Scripts', () => {
    const packagePath = path.join(__dirname, '../../package.json');

    it('should have analyze:file script', () => {
      const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));

      expect(pkg.scripts['analyze:file']).toBeDefined();
    });

    it('should have analyze:all script', () => {
      const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));

      expect(pkg.scripts['analyze:all']).toBeDefined();
    });

    it('should have analyze:watch script', () => {
      const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));

      expect(pkg.scripts['analyze:watch']).toBeDefined();
    });

    it('should have analyze:fix script', () => {
      const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));

      expect(pkg.scripts['analyze:fix']).toBeDefined();
      expect(pkg.scripts['analyze:fix']).toContain('auto-fixer');
    });

    it('should have analyze:report script', () => {
      const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));

      expect(pkg.scripts['analyze:report']).toBeDefined();
      expect(pkg.scripts['analyze:report']).toContain('report');
    });
  });

  describe('Watch Script', () => {
    const watchPath = path.join(__dirname, '../../scripts/analysis/watch-analysis.sh');

    it('should exist', () => {
      expect(fs.existsSync(watchPath)).toBe(true);
    });

    it('should be executable', () => {
      const stats = fs.statSync(watchPath);
      const isExecutable = (stats.mode & 0o111) !== 0;

      expect(isExecutable).toBe(true);
    });

    it('should support target directory argument', () => {
      const content = fs.readFileSync(watchPath, 'utf-8');

      expect(content).toContain('TARGET_DIR=${1');
    });

    it('should detect file changes', () => {
      const content = fs.readFileSync(watchPath, 'utf-8');

      expect(content).toContain('fswatch');
    });

    it('should run analysis on changes', () => {
      const content = fs.readFileSync(watchPath, 'utf-8');

      expect(content).toContain('multi-agent-analysis');
    });
  });
});
