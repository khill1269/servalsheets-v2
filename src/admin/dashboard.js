/**
 * Admin Dashboard Client-Side JavaScript
 */

// API base URL
const API_BASE = '';

// Refresh interval (5 seconds)
const REFRESH_INTERVAL = 5000;

// State
let refreshTimer = null;

/**
 * Initialize dashboard
 */
async function init() {
  await loadServerInfo();
  await loadCircuitBreakers();
  await loadDeduplicationStats();
  await loadSessions();
  await loadRequestLogs();

  // Start auto-refresh
  startAutoRefresh();

  // Setup event listeners
  document.getElementById('refresh-logs').addEventListener('click', loadRequestLogs);
  document.getElementById('clear-logs').addEventListener('click', clearLogs);
}

/**
 * Load server information
 */
async function loadServerInfo() {
  try {
    const response = await fetch(`${API_BASE}/admin/api/server-info`);
    const data = await response.json();

    document.getElementById('version').textContent = data.version;
    document.getElementById('protocol').textContent = data.protocolVersion;
    document.getElementById('tool-count').textContent = data.toolCount;
    document.getElementById('action-count').textContent = data.actionCount;
    document.getElementById('active-sessions').textContent = data.activeSessions;
    document.getElementById('total-requests').textContent = data.totalRequests.toLocaleString();
    document.getElementById('uptime').textContent = `Uptime: ${formatUptime(data.uptime)}`;

    // Update status badge
    const statusBadge = document.getElementById('server-status');
    statusBadge.className = `status-badge status-${data.status}`;
    statusBadge.textContent = data.status.charAt(0).toUpperCase() + data.status.slice(1);
  } catch (error) {
    console.error('Failed to load server info:', error);
  }
}

/**
 * Load circuit breaker status
 */
async function loadCircuitBreakers() {
  try {
    const response = await fetch(`${API_BASE}/metrics/circuit-breakers`);
    const breakers = await response.json();

    const container = document.getElementById('circuit-breakers');

    if (breakers.length === 0) {
      container.innerHTML = '<p class="loading">No circuit breakers registered</p>';
      return;
    }

    container.innerHTML = breakers
      .map(
        (breaker) => `
      <div class="circuit-breaker">
        <div class="circuit-breaker-name">${escapeHtml(breaker.name)}</div>
        <div class="circuit-breaker-state">
          <span class="circuit-state ${breaker.state.toLowerCase()}">${breaker.state}</span>
          <span>${breaker.successCount} success / ${breaker.failureCount} failures</span>
        </div>
      </div>
    `
      )
      .join('');
  } catch (error) {
    console.error('Failed to load circuit breakers:', error);
    document.getElementById('circuit-breakers').innerHTML =
      '<p class="loading">Failed to load circuit breakers</p>';
  }
}

/**
 * Load deduplication statistics
 */
async function loadDeduplicationStats() {
  try {
    const response = await fetch(`${API_BASE}/admin/api/deduplication-stats`);
    const stats = await response.json();

    document.getElementById('dedup-total').textContent = stats.totalRequests.toLocaleString();
    document.getElementById('dedup-saved').textContent = stats.totalSavedRequests.toLocaleString();
    document.getElementById('dedup-cache-hits').textContent = stats.cacheHits.toLocaleString();
    document.getElementById('dedup-rate').textContent = `${stats.totalSavingsRate.toFixed(1)}%`;
  } catch (error) {
    console.error('Failed to load deduplication stats:', error);
  }
}

/**
 * Load active sessions
 */
async function loadSessions() {
  try {
    const response = await fetch(`${API_BASE}/admin/api/sessions`);
    const sessions = await response.json();

    const container = document.getElementById('sessions-list');

    if (sessions.length === 0) {
      container.innerHTML = '<p class="loading">No active sessions</p>';
      return;
    }

    container.innerHTML = sessions
      .map(
        (session) => `
      <div class="session-item">
        <div class="session-header">
          <span class="session-id">${escapeHtml(session.id)}</span>
          <span class="session-time">${formatRelativeTime(session.createdAt)}</span>
        </div>
        <div>${session.clientName || 'Unknown Client'} v${session.clientVersion || '?'}</div>
      </div>
    `
      )
      .join('');
  } catch (error) {
    console.error('Failed to load sessions:', error);
    document.getElementById('sessions-list').innerHTML =
      '<p class="loading">Failed to load sessions</p>';
  }
}

/**
 * Load recent request logs
 */
async function loadRequestLogs() {
  try {
    const response = await fetch(`${API_BASE}/admin/api/request-logs?limit=50`);
    const logs = await response.json();

    const container = document.getElementById('request-logs');

    if (logs.length === 0) {
      container.innerHTML = '<p class="loading">No request logs available</p>';
      return;
    }

    container.innerHTML = logs
      .map(
        (log) => `
      <div class="log-item">
        <span class="log-time">${formatTime(log.timestamp)}</span>
        <span class="log-tool">${escapeHtml(log.tool_name)}</span>
        <span class="log-action">${escapeHtml(log.action)}</span>
        <span class="log-status ${log.error_message ? 'error' : 'success'}">
          ${log.error_message ? 'ERROR' : 'OK'} (${log.duration_ms}ms)
        </span>
      </div>
    `
      )
      .join('');
  } catch (error) {
    console.error('Failed to load request logs:', error);
    document.getElementById('request-logs').innerHTML =
      '<p class="loading">Failed to load request logs</p>';
  }
}

/**
 * Clear request logs
 */
async function clearLogs() {
  if (!confirm('Are you sure you want to clear all request logs?')) {
    return;
  }

  try {
    await fetch(`${API_BASE}/admin/api/request-logs`, { method: 'DELETE' });
    await loadRequestLogs();
  } catch (error) {
    console.error('Failed to clear logs:', error);
    alert('Failed to clear logs');
  }
}

/**
 * Reset all circuit breakers
 */
async function resetCircuitBreakers() {
  if (!confirm('Are you sure you want to reset all circuit breakers?')) {
    return;
  }

  try {
    await fetch(`${API_BASE}/admin/api/circuit-breakers/reset`, { method: 'POST' });
    await loadCircuitBreakers();
    alert('Circuit breakers reset successfully');
  } catch (error) {
    console.error('Failed to reset circuit breakers:', error);
    alert('Failed to reset circuit breakers');
  }
}

/**
 * Clear deduplication cache
 */
async function clearDeduplicationCache() {
  if (!confirm('Are you sure you want to clear the deduplication cache?')) {
    return;
  }

  try {
    await fetch(`${API_BASE}/admin/api/deduplication/clear`, { method: 'POST' });
    await loadDeduplicationStats();
    alert('Deduplication cache cleared successfully');
  } catch (error) {
    console.error('Failed to clear cache:', error);
    alert('Failed to clear cache');
  }
}

/**
 * Shutdown server
 */
async function shutdownServer() {
  if (
    !confirm('⚠️ WARNING: This will shut down the ServalSheets server.\n\nAre you absolutely sure?')
  ) {
    return;
  }

  try {
    await fetch(`${API_BASE}/admin/api/shutdown`, { method: 'POST' });
    alert('Server is shutting down...');
    stopAutoRefresh();
  } catch (error) {
    console.error('Failed to shutdown server:', error);
    alert('Failed to shutdown server');
  }
}

/**
 * Start auto-refresh
 */
function startAutoRefresh() {
  refreshTimer = setInterval(async () => {
    await loadServerInfo();
    await loadCircuitBreakers();
    await loadDeduplicationStats();
    await loadSessions();
  }, REFRESH_INTERVAL);
}

/**
 * Stop auto-refresh
 */
function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

/**
 * Format uptime
 */
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);

  return parts.join(' ');
}

/**
 * Format timestamp
 */
function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString();
}

/**
 * Format relative time
 */
function formatRelativeTime(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
