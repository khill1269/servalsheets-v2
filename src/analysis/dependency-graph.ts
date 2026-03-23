/**
 * ServalSheets - Formula Dependency Graph
 *
 * Implements a directed acyclic graph (DAG) for tracking formula dependencies.
 * Features:
 * - Add/remove dependencies
 * - Cycle detection (circular references)
 * - Topological sort (evaluation order)
 * - Impact analysis (affected cells when a cell changes)
 * - Dependency visualization
 *
 * Example:
 * ```
 * const graph = new DependencyGraph();
 * graph.addDependency('A1', 'B1'); // A1 depends on B1
 * graph.addDependency('B1', 'C1'); // B1 depends on C1
 * graph.getAffectedCells('C1'); // Returns ['B1', 'A1']
 * ```
 *
 * @category Analysis
 */

import { logger } from '../utils/logger.js';
import { DataError } from '../core/errors.js';

/**
 * Graph node representing a cell
 */
interface GraphNode {
  /** Cell identifier (A1, Sheet1!B2, etc.) */
  cell: string;
  /** Cells this cell depends on (inputs) */
  dependencies: Set<string>;
  /** Cells that depend on this cell (outputs) */
  dependents: Set<string>;
  /** Formula (if any) */
  formula?: string;
}

/**
 * Circular dependency chain
 */
export interface CircularDependency {
  /** Cells involved in the cycle */
  cycle: string[];
  /** Human-readable cycle chain */
  chain: string;
  /** Severity level */
  severity: 'error';
}

/**
 * Dependency statistics
 */
export interface DependencyStats {
  /** Total number of cells in graph */
  totalCells: number;
  /** Number of cells with formulas */
  formulaCells: number;
  /** Number of cells without formulas */
  valueCells: number;
  /** Number of dependency edges */
  totalDependencies: number;
  /** Maximum dependency depth */
  maxDepth: number;
  /** Cells with most dependencies */
  mostComplexCells: Array<{ cell: string; dependencyCount: number }>;
  /** Cells with most dependents */
  mostInfluentialCells: Array<{ cell: string; dependentCount: number }>;
}

/**
 * Formula Dependency Graph
 *
 * Tracks dependencies between cells in a spreadsheet.
 */
export class DependencyGraph {
  /** Graph nodes (cell -> node) */
  private nodes: Map<string, GraphNode>;

  /** Cached topological sort (invalidated on changes) */
  private cachedSort: string[] | null = null;

  constructor() {
    this.nodes = new Map();
  }

  /**
   * Add a dependency: fromCell depends on toCell
   *
   * Example: addDependency('A1', 'B1') means A1's formula references B1
   *
   * @param fromCell - Cell with formula
   * @param toCell - Cell referenced in formula
   * @param formula - Optional formula text
   */
  addDependency(fromCell: string, toCell: string, formula?: string): void {
    // Ensure both nodes exist
    if (!this.nodes.has(fromCell)) {
      this.nodes.set(fromCell, {
        cell: fromCell,
        dependencies: new Set(),
        dependents: new Set(),
        formula,
      });
    }

    if (!this.nodes.has(toCell)) {
      this.nodes.set(toCell, {
        cell: toCell,
        dependencies: new Set(),
        dependents: new Set(),
      });
    }

    const fromNode = this.nodes.get(fromCell)!;
    const toNode = this.nodes.get(toCell)!;

    // Add edge
    fromNode.dependencies.add(toCell);
    toNode.dependents.add(fromCell);

    // Update formula if provided
    if (formula !== undefined) {
      fromNode.formula = formula;
    }

    // Invalidate cached sort
    this.cachedSort = null;

    logger.debug('Dependency added', {
      from: fromCell,
      to: toCell,
      hasFormula: !!formula,
    });
  }

  /**
   * Remove a dependency edge
   *
   * @param fromCell - Cell with formula
   * @param toCell - Cell referenced in formula
   */
  removeDependency(fromCell: string, toCell: string): void {
    const fromNode = this.nodes.get(fromCell);
    const toNode = this.nodes.get(toCell);

    if (fromNode) {
      fromNode.dependencies.delete(toCell);
    }

    if (toNode) {
      toNode.dependents.delete(fromCell);
    }

    // Invalidate cached sort
    this.cachedSort = null;

    logger.debug('Dependency removed', {
      from: fromCell,
      to: toCell,
    });
  }

  /**
   * Remove all dependencies for a cell
   *
   * @param cell - Cell identifier
   */
  removeCell(cell: string): void {
    const node = this.nodes.get(cell);
    if (!node) return;

    // Remove outgoing edges (this cell depends on others)
    for (const dep of node.dependencies) {
      const depNode = this.nodes.get(dep);
      if (depNode) {
        depNode.dependents.delete(cell);
      }
    }

    // Remove incoming edges (others depend on this cell)
    for (const dependent of node.dependents) {
      const depNode = this.nodes.get(dependent);
      if (depNode) {
        depNode.dependencies.delete(cell);
      }
    }

    // Remove node
    this.nodes.delete(cell);

    // Invalidate cached sort
    this.cachedSort = null;

    logger.debug('Cell removed from graph', { cell });
  }

  /**
   * Get all cells that depend on the given cell (directly or indirectly)
   *
   * This performs a breadth-first traversal up the dependency graph.
   *
   * @param cell - Cell identifier
   * @returns Array of affected cells in dependency order
   */
  getAffectedCells(cell: string): string[] {
    const affected: string[] = [];
    const visited = new Set<string>();
    const queue: string[] = [cell];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (visited.has(current)) {
        continue;
      }

      visited.add(current);

      // Skip the original cell
      if (current !== cell) {
        affected.push(current);
      }

      // Add dependents to queue
      const node = this.nodes.get(current);
      if (node) {
        for (const dependent of node.dependents) {
          if (!visited.has(dependent)) {
            queue.push(dependent);
          }
        }
      }
    }

    logger.debug('Affected cells calculated', {
      cell,
      affectedCount: affected.length,
    });

    return affected;
  }

  /**
   * Get all cells that the given cell depends on (directly or indirectly)
   *
   * This performs a breadth-first traversal down the dependency graph.
   *
   * @param cell - Cell identifier
   * @returns Array of dependency cells
   */
  getDependencies(cell: string): string[] {
    const dependencies: string[] = [];
    const visited = new Set<string>();
    const queue: string[] = [cell];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (visited.has(current)) {
        continue;
      }

      visited.add(current);

      // Skip the original cell
      if (current !== cell) {
        dependencies.push(current);
      }

      // Add dependencies to queue
      const node = this.nodes.get(current);
      if (node) {
        for (const dep of node.dependencies) {
          if (!visited.has(dep)) {
            queue.push(dep);
          }
        }
      }
    }

    return dependencies;
  }

  /**
   * Detect circular dependencies (cycles) in the graph
   *
   * Uses depth-first search with recursion stack to find cycles.
   *
   * @returns Array of circular dependencies found
   */
  detectCycles(): CircularDependency[] {
    const cycles: CircularDependency[] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    const dfs = (cell: string): boolean => {
      visited.add(cell);
      recursionStack.add(cell);
      path.push(cell);

      const node = this.nodes.get(cell);
      if (node) {
        for (const dep of node.dependencies) {
          if (!visited.has(dep)) {
            if (dfs(dep)) {
              return true; // Cycle found
            }
          } else if (recursionStack.has(dep)) {
            // Cycle detected - extract cycle from path
            const cycleStart = path.indexOf(dep);
            const cycle = [...path.slice(cycleStart), dep];

            cycles.push({
              cycle,
              chain: cycle.join(' → '),
              severity: 'error',
            });

            return true;
          }
        }
      }

      recursionStack.delete(cell);
      path.pop();
      return false;
    };

    // Check all nodes
    for (const cell of this.nodes.keys()) {
      if (!visited.has(cell)) {
        dfs(cell);
      }
    }

    if (cycles.length > 0) {
      logger.warn('Circular dependencies detected', {
        count: cycles.length,
        cycles: cycles.map((c) => c.chain),
      });
    }

    return cycles;
  }

  /**
   * Perform topological sort of the graph
   *
   * Returns cells in dependency order (dependencies before dependents).
   * Throws error if graph contains cycles.
   *
   * @returns Array of cells in evaluation order
   */
  topologicalSort(): string[] {
    if (this.cachedSort) {
      return this.cachedSort;
    }

    const sorted: string[] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (cell: string): void => {
      if (visited.has(cell)) {
        return;
      }

      if (recursionStack.has(cell)) {
        throw new DataError(`Circular dependency detected at ${cell}`, 'DATA_ERROR', false, {
          cell,
        });
      }

      recursionStack.add(cell);

      const node = this.nodes.get(cell);
      if (node) {
        // Visit dependencies first
        for (const dep of node.dependencies) {
          dfs(dep);
        }
      }

      recursionStack.delete(cell);
      visited.add(cell);
      sorted.push(cell);
    };

    // Process all nodes
    for (const cell of this.nodes.keys()) {
      if (!visited.has(cell)) {
        dfs(cell);
      }
    }

    this.cachedSort = sorted;

    logger.debug('Topological sort computed', {
      cellCount: sorted.length,
    });

    return sorted;
  }

  /**
   * Get dependency statistics
   *
   * @returns Statistics about the dependency graph
   */
  getStats(): DependencyStats {
    let formulaCells = 0;
    let totalDependencies = 0;
    const complexCells: Array<{ cell: string; dependencyCount: number }> = [];
    const influentialCells: Array<{ cell: string; dependentCount: number }> = [];

    for (const [cell, node] of this.nodes) {
      if (node.formula) {
        formulaCells++;
      }

      const depCount = node.dependencies.size;
      const dependentCount = node.dependents.size;

      totalDependencies += depCount;

      if (depCount > 0) {
        complexCells.push({ cell, dependencyCount: depCount });
      }

      if (dependentCount > 0) {
        influentialCells.push({ cell, dependentCount });
      }
    }

    // Sort and get top 10
    complexCells.sort((a, b) => b.dependencyCount - a.dependencyCount);
    influentialCells.sort((a, b) => b.dependentCount - a.dependentCount);

    // Calculate max depth
    let maxDepth = 0;
    for (const cell of this.nodes.keys()) {
      const depth = this.getDepth(cell);
      maxDepth = Math.max(maxDepth, depth);
    }

    return {
      totalCells: this.nodes.size,
      formulaCells,
      valueCells: this.nodes.size - formulaCells,
      totalDependencies,
      maxDepth,
      mostComplexCells: complexCells.slice(0, 10),
      mostInfluentialCells: influentialCells.slice(0, 10),
    };
  }

  /**
   * Get dependency depth for a cell
   *
   * Depth = longest path from any leaf to this cell
   *
   * @param cell - Cell identifier
   * @returns Depth level
   */
  private getDepth(cell: string, visited = new Set<string>()): number {
    if (visited.has(cell)) {
      return 0; // Cycle or already visited
    }

    visited.add(cell);

    const node = this.nodes.get(cell);
    if (!node || node.dependencies.size === 0) {
      return 0; // Leaf node
    }

    let maxDepth = 0;
    for (const dep of node.dependencies) {
      const depth = this.getDepth(dep, new Set(visited));
      maxDepth = Math.max(maxDepth, depth);
    }

    return maxDepth + 1;
  }

  /**
   * Export graph as DOT format for visualization
   *
   * Can be rendered with Graphviz or online tools like:
   * - https://dreampuf.github.io/GraphvizOnline/
   * - https://graphviz.org/
   *
   * @returns DOT format string
   */
  toDOT(): string {
    const lines: string[] = [];
    lines.push('digraph DependencyGraph {');
    lines.push('  rankdir=LR;');
    lines.push('  node [shape=box];');
    lines.push('');

    // Add nodes
    for (const [cell, node] of this.nodes) {
      const hasFormula = !!node.formula;
      const style = hasFormula ? 'filled' : '';
      const fillcolor = hasFormula ? 'lightblue' : 'white';

      lines.push(`  "${cell}" [style="${style}" fillcolor="${fillcolor}"];`);
    }

    lines.push('');

    // Add edges
    for (const [cell, node] of this.nodes) {
      for (const dep of node.dependencies) {
        lines.push(`  "${cell}" -> "${dep}";`);
      }
    }

    lines.push('}');

    return lines.join('\n');
  }

  /**
   * Clear all nodes and edges
   */
  clear(): void {
    this.nodes.clear();
    this.cachedSort = null;
    logger.debug('Dependency graph cleared');
  }

  /**
   * Get node count
   */
  get size(): number {
    return this.nodes.size;
  }
}
