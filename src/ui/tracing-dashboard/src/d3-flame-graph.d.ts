declare module 'd3-flame-graph' {
  import type { Selection } from 'd3-selection';
  import type { FlameGraphNode } from './types';

  export interface FlameGraphChart {
    (selection: Selection<HTMLDivElement, FlameGraphNode, null, undefined>): void;
    width(value: number): FlameGraphChart;
    cellHeight(value: number): FlameGraphChart;
    transitionDuration(value: number): FlameGraphChart;
    minFrameSize(value: number): FlameGraphChart;
    transitionEase(value: (normalizedTime: number) => number): FlameGraphChart;
    sort(value: boolean): FlameGraphChart;
    title(value: string): FlameGraphChart;
    tooltip(value: boolean): FlameGraphChart;
  }

  export default function flamegraph(): FlameGraphChart;
}
