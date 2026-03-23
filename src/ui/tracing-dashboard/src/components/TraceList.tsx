import { formatDuration, formatTimestamp, getStatusColor } from '../utils';
import type { RequestTrace } from '../types';
import './TraceList.css';

interface TraceListProps {
  traces: RequestTrace[];
  selectedId?: string;
  onSelect: (requestId: string) => void;
}

export default function TraceList({ traces, selectedId, onSelect }: TraceListProps) {
  if (traces.length === 0) {
    return (
      <div className="trace-list-empty">
        <p>No traces found</p>
      </div>
    );
  }

  return (
    <div className="trace-list">
      {traces.map((trace) => (
        <div
          key={trace.requestId}
          className={`trace-item ${selectedId === trace.requestId ? 'selected' : ''}`}
          onClick={() => onSelect(trace.requestId)}
        >
          <div className="trace-item-header">
            <span className="trace-tool">{trace.tool}</span>
            <span
              className="trace-status"
              style={{
                backgroundColor: getStatusColor(trace.success),
              }}
            />
          </div>

          <div className="trace-action">{trace.action}</div>

          <div className="trace-item-footer">
            <span className="trace-duration">{formatDuration(trace.duration)}</span>
            <span className="trace-time">{formatTimestamp(trace.timestamp)}</span>
          </div>

          {trace.errorCode && (
            <div className="trace-error">
              <span className="error-code">{trace.errorCode}</span>
              {trace.errorMessage && <span className="error-message">{trace.errorMessage}</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
