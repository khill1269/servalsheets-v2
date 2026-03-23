import { useState, useEffect } from 'react';
import TraceList from './components/TraceList';
import TraceDetail from './components/TraceDetail';
import StatsPanel from './components/StatsPanel';
import FilterBar from './components/FilterBar';
import { tracingAPI } from './api';
import type { RequestTrace, TraceStats, TraceSearchFilters } from './types';
import './App.css';

type View = 'recent' | 'slow' | 'errors';

export default function App() {
  const [traces, setTraces] = useState<RequestTrace[]>([]);
  const [stats, setStats] = useState<TraceStats | null>(null);
  const [selectedTrace, setSelectedTrace] = useState<RequestTrace | null>(null);
  const [view, setView] = useState<View>('recent');
  const [filters, setFilters] = useState<TraceSearchFilters>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const fetchTraces = async () => {
    try {
      setLoading(true);
      setError(null);

      let fetchedTraces: RequestTrace[];
      switch (view) {
        case 'recent':
          fetchedTraces = await tracingAPI.getRecentTraces(100);
          break;
        case 'slow':
          fetchedTraces = await tracingAPI.getSlowestTraces(50);
          break;
        case 'errors':
          fetchedTraces = await tracingAPI.getErrorTraces(50);
          break;
      }

      setTraces(fetchedTraces);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch traces');
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const stats = await tracingAPI.getStats();
      setStats(stats);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  };

  useEffect(() => {
    fetchTraces();
    fetchStats();
  }, [view]);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchTraces();
      fetchStats();
    }, 5000);

    return () => clearInterval(interval);
  }, [autoRefresh, view]);

  const handleSelectTrace = async (requestId: string) => {
    try {
      const trace = await tracingAPI.getTrace(requestId);
      setSelectedTrace(trace);
    } catch (err) {
      console.error('Failed to fetch trace details:', err);
    }
  };

  const handleFilterChange = async (newFilters: TraceSearchFilters) => {
    setFilters(newFilters);
    try {
      setLoading(true);
      const filtered = await tracingAPI.searchTraces(newFilters);
      setTraces(filtered);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search traces');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-left">
          <h1>ServalSheets Tracing</h1>
          <nav className="view-nav">
            <button className={view === 'recent' ? 'active' : ''} onClick={() => setView('recent')}>
              Recent
            </button>
            <button className={view === 'slow' ? 'active' : ''} onClick={() => setView('slow')}>
              Slowest
            </button>
            <button className={view === 'errors' ? 'active' : ''} onClick={() => setView('errors')}>
              Errors
            </button>
          </nav>
        </div>
        <div className="app-header-right">
          <label className="auto-refresh">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh
          </label>
          <button className="btn-refresh" onClick={fetchTraces}>
            Refresh
          </button>
        </div>
      </header>

      {stats && <StatsPanel stats={stats} />}

      <div className="app-content">
        <div className="sidebar">
          <FilterBar filters={filters} onChange={handleFilterChange} />
          {loading && <div className="loading">Loading traces...</div>}
          {error && <div className="error-message">{error}</div>}
          {!loading && !error && (
            <TraceList
              traces={traces}
              selectedId={selectedTrace?.requestId}
              onSelect={handleSelectTrace}
            />
          )}
        </div>

        <div className="main-panel">
          {selectedTrace ? (
            <TraceDetail trace={selectedTrace} onClose={() => setSelectedTrace(null)} />
          ) : (
            <div className="empty-state">
              <p>Select a trace to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
