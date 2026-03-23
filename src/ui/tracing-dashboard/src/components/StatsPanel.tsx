import { formatDuration } from '../utils';
import type { TraceStats } from '../types';
import './StatsPanel.css';

interface StatsPanelProps {
  stats: TraceStats;
}

export default function StatsPanel({ stats }: StatsPanelProps) {
  const successRate = stats.totalTraces > 0 ? (stats.successCount / stats.totalTraces) * 100 : 0;

  return (
    <div className="stats-panel">
      <div className="stat-card">
        <div className="stat-label">Total Traces</div>
        <div className="stat-value">{stats.totalTraces.toLocaleString()}</div>
      </div>

      <div className="stat-card">
        <div className="stat-label">Success Rate</div>
        <div className="stat-value" style={{ color: successRate > 95 ? '#10b981' : '#f59e0b' }}>
          {successRate.toFixed(1)}%
        </div>
      </div>

      <div className="stat-card">
        <div className="stat-label">Avg Duration</div>
        <div className="stat-value">{formatDuration(stats.averageDuration)}</div>
      </div>

      <div className="stat-card">
        <div className="stat-label">P50 Duration</div>
        <div className="stat-value">{formatDuration(stats.p50Duration)}</div>
      </div>

      <div className="stat-card">
        <div className="stat-label">P95 Duration</div>
        <div className="stat-value">{formatDuration(stats.p95Duration)}</div>
      </div>

      <div className="stat-card">
        <div className="stat-label">P99 Duration</div>
        <div className="stat-value">{formatDuration(stats.p99Duration)}</div>
      </div>
    </div>
  );
}
