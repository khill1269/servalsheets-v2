import { useState } from 'react';
import FlameGraph from './FlameGraph';
import SpanTable from './SpanTable';
import { formatDuration, formatTimestamp, exportTracesAsJSON } from '../utils';
import type { RequestTrace } from '../types';
import './TraceDetail.css';

interface TraceDetailProps {
  trace: RequestTrace;
  onClose: () => void;
}

type ViewMode = 'flamegraph' | 'spans' | 'metadata';

export default function TraceDetail({ trace, onClose }: TraceDetailProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('flamegraph');

  const handleExport = () => {
    exportTracesAsJSON([trace], `trace-${trace.requestId}.json`);
  };

  return (
    <div className="trace-detail">
      <div className="trace-detail-header">
        <div className="trace-detail-title">
          <h2>
            {trace.tool}.{trace.action}
          </h2>
          <span className={`trace-badge ${trace.success ? 'success' : 'error'}`}>
            {trace.success ? 'Success' : 'Error'}
          </span>
        </div>
        <button className="btn-close" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="trace-detail-info">
        <div className="info-item">
          <span className="info-label">Request ID:</span>
          <code className="info-value">{trace.requestId}</code>
        </div>
        <div className="info-item">
          <span className="info-label">Trace ID:</span>
          <code className="info-value">{trace.traceId}</code>
        </div>
        <div className="info-item">
          <span className="info-label">Duration:</span>
          <span className="info-value">{formatDuration(trace.duration)}</span>
        </div>
        <div className="info-item">
          <span className="info-label">Timestamp:</span>
          <span className="info-value">{formatTimestamp(trace.timestamp)}</span>
        </div>
        <div className="info-item">
          <span className="info-label">Spans:</span>
          <span className="info-value">{trace.spans.length}</span>
        </div>
      </div>

      {trace.errorCode && (
        <div className="trace-detail-error">
          <h3>Error Details</h3>
          <div className="error-code">
            <strong>Code:</strong> {trace.errorCode}
          </div>
          {trace.errorMessage && (
            <div className="error-message">
              <strong>Message:</strong> {trace.errorMessage}
            </div>
          )}
        </div>
      )}

      <div className="trace-detail-toolbar">
        <div className="view-mode-tabs">
          <button
            className={viewMode === 'flamegraph' ? 'active' : ''}
            onClick={() => setViewMode('flamegraph')}
          >
            Flame Graph
          </button>
          <button
            className={viewMode === 'spans' ? 'active' : ''}
            onClick={() => setViewMode('spans')}
          >
            Spans ({trace.spans.length})
          </button>
          <button
            className={viewMode === 'metadata' ? 'active' : ''}
            onClick={() => setViewMode('metadata')}
          >
            Metadata
          </button>
        </div>
        <button className="btn-export" onClick={handleExport}>
          Export JSON
        </button>
      </div>

      <div className="trace-detail-content">
        {viewMode === 'flamegraph' && <FlameGraph trace={trace} />}
        {viewMode === 'spans' && <SpanTable spans={trace.spans} />}
        {viewMode === 'metadata' && (
          <div className="metadata-view">
            {trace.metadata ? (
              <pre>{JSON.stringify(trace.metadata, null, 2)}</pre>
            ) : (
              <p className="no-metadata">No metadata available</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
