import { formatDuration } from '../utils';
import type { TraceSpan } from '../types';
import './SpanTable.css';

interface SpanTableProps {
  spans: TraceSpan[];
}

export default function SpanTable({ spans }: SpanTableProps) {
  // Sort spans by start time
  const sortedSpans = [...spans].sort((a, b) => a.startTime - b.startTime);

  return (
    <div className="span-table-container">
      <table className="span-table">
        <thead>
          <tr>
            <th>Span Name</th>
            <th>Kind</th>
            <th>Duration</th>
            <th>Status</th>
            <th>Attributes</th>
          </tr>
        </thead>
        <tbody>
          {sortedSpans.map((span) => (
            <tr key={span.spanId}>
              <td className="span-name">
                <code>{span.name}</code>
              </td>
              <td className="span-kind">
                <span className={`kind-badge ${span.kind}`}>{span.kind}</span>
              </td>
              <td className="span-duration">{formatDuration(span.duration)}</td>
              <td className="span-status">
                <span className={`status-badge ${span.status}`}>{span.status}</span>
              </td>
              <td className="span-attributes">
                {Object.keys(span.attributes).length > 0 ? (
                  <details>
                    <summary>{Object.keys(span.attributes).length} attributes</summary>
                    <pre>{JSON.stringify(span.attributes, null, 2)}</pre>
                  </details>
                ) : (
                  <span className="no-attributes">None</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
