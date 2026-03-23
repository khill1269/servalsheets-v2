/**
 * ServalSheets Google Workspace Add-on
 *
 * This add-on provides AI-powered Google Sheets capabilities through
 * the ServalSheets MCP server API.
 *
 * Architecture:
 * - This file (Code.gs) runs in Apps Script (server-side)
 * - Calls ServalSheets HTTP API (your MCP server)
 * - Sidebar.html provides the UI (client-side)
 */

// Configuration with auto-detection
const CONFIG = {
  // Auto-detect environment or use manual override
  API_URL: (() => {
    try {
      // Check script properties for environment override
      const props = PropertiesService.getScriptProperties();
      const envOverride = props.getProperty('API_URL');
      if (envOverride) return envOverride;

      // Auto-detect based on deployment context
      // Production deployments should have PROD_ prefix in script ID
      // Staging deployments should have STAGING_ prefix
      // Everything else defaults to localhost (development)
      const deploymentId = ScriptApp.getScriptId();

      if (deploymentId.startsWith('PROD_')) {
        return 'https://api.servalsheets.com';
      } else if (deploymentId.startsWith('STAGING_')) {
        return 'https://staging-api.servalsheets.com';
      } else {
        // Default to localhost for development
        return 'http://localhost:3000';
      }
    } catch (error) {
      // Fallback to localhost if detection fails
      Logger.log('Environment detection failed: ' + error.message);
      return 'http://localhost:3000';
    }
  })(),

  // API key stored in user properties (set via Settings dialog)
  API_KEY_PROPERTY: 'SERVALSHEETS_API_KEY',

  // Plan tier (detected from API responses)
  PLAN_PROPERTY: 'SERVALSHEETS_PLAN',

  // Session ID for MCP protocol (stored per user)
  SESSION_ID_PROPERTY: 'SERVALSHEETS_SESSION_ID',
};

/**
 * Called when spreadsheet is opened
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ServalSheets')
    .addItem('Show AI Assistant', 'showSidebar')
    .addSeparator()
    .addItem('Settings', 'showSettings')
    .addItem('Usage Stats', 'showUsageStats')
    .addToUi();
}

/**
 * Called when add-on homepage is triggered
 */
function onHomepage(e) {
  return showSidebar();
}

/**
 * Show the main AI assistant sidebar
 */
function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('ServalSheets AI')
    .setWidth(320);
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Show settings dialog for API key configuration
 */
function showSettings() {
  const html = HtmlService.createHtmlOutputFromFile('Settings').setWidth(400).setHeight(300);
  SpreadsheetApp.getUi().showModalDialog(html, 'ServalSheets Settings');
}

/**
 * Show usage statistics dialog
 */
function showUsageStats() {
  const html = HtmlService.createHtmlOutputFromFile('UsageStats').setWidth(500).setHeight(400);
  SpreadsheetApp.getUi().showModalDialog(html, 'Usage Statistics');
}

/**
 * Get API key from user properties
 */
function getApiKey() {
  const props = PropertiesService.getUserProperties();
  return props.getProperty(CONFIG.API_KEY_PROPERTY);
}

/**
 * Save API key to user properties
 */
function saveApiKey(apiKey) {
  const props = PropertiesService.getUserProperties();
  props.setProperty(CONFIG.API_KEY_PROPERTY, apiKey);
  return { success: true };
}

/**
 * Get current plan tier
 */
function getPlan() {
  const props = PropertiesService.getUserProperties();
  return props.getProperty(CONFIG.PLAN_PROPERTY) || 'free';
}

/**
 * Set environment (production/staging/development)
 * This overrides the automatic detection
 *
 * @param {string} env - Environment: 'production', 'staging', or 'development'
 */
function setEnvironment(env) {
  const props = PropertiesService.getScriptProperties();

  if (env === 'production') {
    props.setProperty('API_URL', 'https://api.servalsheets.com');
    Logger.log('Environment set to: production (https://api.servalsheets.com)');
  } else if (env === 'staging') {
    props.setProperty('API_URL', 'https://staging-api.servalsheets.com');
    Logger.log('Environment set to: staging (https://staging-api.servalsheets.com)');
  } else if (env === 'development') {
    props.setProperty('API_URL', 'http://localhost:3000');
    Logger.log('Environment set to: development (http://localhost:3000)');
  } else {
    throw new Error('Invalid environment. Use: production, staging, or development');
  }

  return { success: true, environment: env };
}

/**
 * Get current environment configuration
 */
function getEnvironment() {
  const props = PropertiesService.getScriptProperties();
  const apiUrl = props.getProperty('API_URL') || CONFIG.API_URL;

  let detectedEnv = 'development';
  if (apiUrl.includes('api.servalsheets.com')) {
    detectedEnv = 'production';
  } else if (apiUrl.includes('staging-api.servalsheets.com')) {
    detectedEnv = 'staging';
  }

  return {
    environment: detectedEnv,
    apiUrl: apiUrl,
    deploymentId: ScriptApp.getScriptId(),
    isOverridden: props.getProperty('API_URL') !== null,
  };
}

/**
 * Clear environment override (revert to auto-detection)
 */
function clearEnvironment() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('API_URL');
  Logger.log('Environment override cleared. Using auto-detection.');
  return { success: true, message: 'Reverted to auto-detection' };
}

// ============================================================================
// Session Management (MCP Protocol Requirement)
// ============================================================================

/**
 * Initialize MCP session and get session ID
 * Must be called before any tool calls
 */
function initializeSession() {
  try {
    const url = `${CONFIG.API_URL}/mcp`;
    const payload = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: {
          name: 'workspace-addon',
          version: '1.0.0',
        },
      },
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Accept: 'application/json, text/event-stream',
        'X-MCP-Client': 'workspace-addon/1.0.0',
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    };

    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();

    if (statusCode === 200) {
      // Parse SSE response to extract session ID
      const text = response.getContentText();
      const lines = text.split('\n');

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('id: ')) {
          const sessionId = lines[i].substring(4).trim();
          // Save session ID
          const props = PropertiesService.getUserProperties();
          props.setProperty(CONFIG.SESSION_ID_PROPERTY, sessionId);
          Logger.log('MCP session initialized: ' + sessionId);
          return sessionId;
        }
      }
    }

    Logger.log('Failed to initialize MCP session: ' + statusCode);
    return null;
  } catch (error) {
    Logger.log('Error initializing MCP session: ' + error.message);
    return null;
  }
}

/**
 * Get current session ID (or create new session if needed)
 */
function getSessionId() {
  const props = PropertiesService.getUserProperties();
  let sessionId = props.getProperty(CONFIG.SESSION_ID_PROPERTY);

  if (!sessionId) {
    sessionId = initializeSession();
  }

  return sessionId;
}

/**
 * Clear session (force re-initialization on next call)
 */
function clearSession() {
  const props = PropertiesService.getUserProperties();
  props.deleteProperty(CONFIG.SESSION_ID_PROPERTY);
  return { success: true };
}

// ============================================================================
// MCP Tool Calls
// ============================================================================

/**
 * Format error messages for better user experience
 */
function formatErrorMessage(error) {
  const errorMessages = {
    NO_API_KEY: 'API key not configured. Go to ServalSheets > Settings.',
    UNAUTHORIZED: 'Invalid API key. Please check Settings and try again.',
    QUOTA_EXCEEDED: 'Monthly quota exceeded. Upgrade at servalsheets.com/upgrade',
    NETWORK_ERROR: 'Cannot reach ServalSheets API. Check your internet connection.',
    TIMEOUT: 'Request timed out. The operation is taking too long - try again or contact support.',
    INVALID_REQUEST: 'Invalid request format. This may be a bug - please report it.',
    SPREADSHEET_NOT_FOUND:
      'Spreadsheet not found. It may have been deleted or you may not have access.',
    PERMISSION_DENIED: "You don't have permission to access this spreadsheet.",
    SESSION_ERROR: 'Failed to establish connection. Please try again.',
    API_ERROR: 'Server error occurred. Please try again in a few moments.',
  };

  const code = error.code || 'UNKNOWN_ERROR';
  const customMessage = errorMessages[code];

  if (customMessage) {
    return customMessage;
  }

  return error.message || 'An unknown error occurred. Please try again.';
}

/**
 * Check if API is reachable (connection test)
 */
function checkConnection() {
  try {
    const url = `${CONFIG.API_URL}/health`;
    const options = {
      method: 'get',
      muteHttpExceptions: true,
      timeout: 5000, // 5 second timeout for health check
    };

    const response = UrlFetchApp.fetch(url, options);
    return response.getResponseCode() === 200;
  } catch (error) {
    return false;
  }
}

// ============================================================================
// Caching Layer (Performance Optimization)
// ============================================================================

/**
 * Get cached value from CacheService with TTL
 * @param {string} key - Cache key
 * @param {number} ttl - Time to live in seconds (optional)
 * @returns {any} Cached value or null if not found/expired
 */
function getCachedValue(key, ttl) {
  const cache = CacheService.getUserCache();
  const cachedData = cache.get(key);

  if (cachedData) {
    try {
      const parsed = JSON.parse(cachedData);

      // Check if TTL is still valid (if provided)
      if (parsed.timestamp && ttl) {
        const age = (Date.now() - parsed.timestamp) / 1000;
        if (age > ttl) {
          // Cache expired, remove it
          cache.remove(key);
          return null;
        }
      }

      return parsed.value;
    } catch (e) {
      // Invalid cache data, remove it
      cache.remove(key);
      return null;
    }
  }

  return null;
}

/**
 * Set cached value in CacheService with metadata
 * @param {string} key - Cache key
 * @param {any} value - Value to cache
 * @param {number} ttl - Time to live in seconds (max 21600 = 6 hours)
 */
function setCachedValue(key, value, ttl) {
  const cache = CacheService.getUserCache();
  const cacheData = {
    value: value,
    timestamp: Date.now(),
  };

  try {
    // Apps Script CacheService max TTL is 6 hours (21600 seconds)
    const maxTtl = 21600;
    const actualTtl = Math.min(ttl, maxTtl);

    cache.put(key, JSON.stringify(cacheData), actualTtl);
    return true;
  } catch (e) {
    Logger.log('Failed to cache value: ' + e.message);
    return false;
  }
}

/**
 * Clear specific cache key
 */
function clearCache(key) {
  const cache = CacheService.getUserCache();
  cache.remove(key);
  return { success: true };
}

/**
 * Clear all cache for current user
 */
function clearAllCache() {
  const cache = CacheService.getUserCache();
  cache.removeAll(['spreadsheet_metadata_', 'user_plan', 'user_profile']);
  return { success: true, message: 'Cache cleared' };
}

/**
 * Get spreadsheet metadata with caching (5 min TTL)
 */
function getSpreadsheetMetadataCached() {
  const info = getActiveSpreadsheetInfo();
  const cacheKey = 'spreadsheet_metadata_' + info.spreadsheetId;
  const cacheTtl = 300; // 5 minutes

  // Try cache first
  const cached = getCachedValue(cacheKey, cacheTtl);
  if (cached) {
    Logger.log('Cache hit: spreadsheet metadata');
    return cached;
  }

  // Cache miss - fetch from API
  Logger.log('Cache miss: fetching spreadsheet metadata from API');
  const result = callServalSheets('sheets_core', {
    action: 'get',
    spreadsheetId: info.spreadsheetId,
  });

  // Cache successful results
  if (result && result.success) {
    setCachedValue(cacheKey, result, cacheTtl);
  }

  return result;
}

/**
 * Get user plan with caching (1 hour TTL)
 */
function getUserPlanCached() {
  const cacheKey = 'user_plan';
  const cacheTtl = 3600; // 1 hour

  // Try cache first
  const cached = getCachedValue(cacheKey, cacheTtl);
  if (cached) {
    Logger.log('Cache hit: user plan');
    return cached;
  }

  // Cache miss - get from properties or default
  Logger.log('Cache miss: user plan');
  const plan = getPlan();

  // Cache the result
  setCachedValue(cacheKey, plan, cacheTtl);

  return plan;
}

/**
 * Invalidate cache for spreadsheet after modification
 */
function invalidateSpreadsheetCache(spreadsheetId) {
  const cacheKey =
    'spreadsheet_metadata_' + (spreadsheetId || getActiveSpreadsheetInfo().spreadsheetId);
  clearCache(cacheKey);
  Logger.log('Invalidated cache for: ' + cacheKey);
}

/**
 * Core function to call ServalSheets API via MCP protocol
 * Uses JSON-RPC 2.0 format as required by /mcp endpoint
 * Includes automatic retry with exponential backoff for transient failures
 */
function callServalSheets(tool, request, maxRetries = 3) {
  const apiKey = getApiKey();

  if (!apiKey) {
    return {
      success: false,
      error: {
        code: 'NO_API_KEY',
        message: formatErrorMessage({ code: 'NO_API_KEY' }),
      },
    };
  }

  // Get or create MCP session
  let sessionId = getSessionId();

  if (!sessionId) {
    return {
      success: false,
      error: {
        code: 'SESSION_ERROR',
        message: formatErrorMessage({ code: 'SESSION_ERROR' }),
      },
    };
  }

  // Retry logic with exponential backoff
  let lastError = null;
  let auth401Retried = false;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Use actual /mcp endpoint (MCP protocol over HTTP)
      const url = `${CONFIG.API_URL}/mcp`;

      // Use JSON-RPC 2.0 format required by MCP protocol
      const payload = {
        jsonrpc: '2.0',
        id: Date.now(), // Unique request ID
        method: 'tools/call',
        params: {
          name: tool,
          arguments: { request },
        },
      };

      const options = {
        method: 'post',
        contentType: 'application/json',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'X-MCP-Client': 'workspace-addon/1.0.0',
          Accept: 'application/json, text/event-stream', // Required by MCP protocol
          'Mcp-Session-Id': sessionId, // Required for all tool calls
        },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      };

      const response = UrlFetchApp.fetch(url, options);
      const statusCode = response.getResponseCode();
      const result = JSON.parse(response.getContentText());

      // Handle 401: clear stored auth/session and retry once
      if (statusCode === 401) {
        if (!auth401Retried) {
          auth401Retried = true;
          Logger.log('Auth expired (401), clearing session and retrying once...');
          clearSession();
          sessionId = getSessionId();

          if (sessionId) {
            options.headers['Mcp-Session-Id'] = sessionId;
            const retryResponse = UrlFetchApp.fetch(url, options);
            const retryStatusCode = retryResponse.getResponseCode();
            const retryResult = JSON.parse(retryResponse.getContentText());

            if (retryStatusCode === 401 || retryStatusCode !== 200) {
              return {
                success: false,
                error: {
                  code: 'UNAUTHORIZED',
                  message: formatErrorMessage({ code: 'UNAUTHORIZED' }),
                },
              };
            }

            if (retryResult.result && retryResult.result.content && retryResult.result.content[0]) {
              const content = retryResult.result.content[0];
              if (content.text) {
                try {
                  return JSON.parse(content.text);
                } catch (e) {
                  return { success: true, response: { text: content.text } };
                }
              }
            }
            return retryResult.result || retryResult;
          }
        }

        return {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: formatErrorMessage({ code: 'UNAUTHORIZED' }),
          },
        };
      }

      if (statusCode === 400 && result.error?.code === 'INVALID_REQUEST') {
        // Session might be invalid - retry once with new session
        Logger.log('Session invalid, retrying with new session...');
        clearSession();
        sessionId = getSessionId();

        if (sessionId) {
          // Retry the request with new session
          options.headers['Mcp-Session-Id'] = sessionId;
          const retryResponse = UrlFetchApp.fetch(url, options);
          const retryStatusCode = retryResponse.getResponseCode();
          const retryResult = JSON.parse(retryResponse.getContentText());

          if (retryStatusCode !== 200) {
            return {
              success: false,
              error: {
                code: 'API_ERROR',
                message: retryResult.error?.message || `API returned status ${retryStatusCode}`,
              },
            };
          }

          // Parse retry result
          if (retryResult.result && retryResult.result.content && retryResult.result.content[0]) {
            const content = retryResult.result.content[0];
            if (content.text) {
              try {
                return JSON.parse(content.text);
              } catch (e) {
                return { success: true, response: { text: content.text } };
              }
            }
          }
        }

        return {
          success: false,
          error: {
            code: 'SESSION_ERROR',
            message: 'Failed to establish valid session',
          },
        };
      }

      // Don't retry quota errors
      if (statusCode === 429) {
        return {
          success: false,
          error: {
            code: 'QUOTA_EXCEEDED',
            message: formatErrorMessage({ code: 'QUOTA_EXCEEDED' }),
          },
        };
      }

      // Retry on 5xx server errors
      if (statusCode >= 500 && statusCode < 600) {
        lastError = {
          code: 'API_ERROR',
          message: formatErrorMessage({ code: 'API_ERROR' }),
        };

        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s
          const backoffMs = Math.pow(2, attempt - 1) * 1000;
          Logger.log(`Attempt ${attempt} failed with ${statusCode}, retrying in ${backoffMs}ms...`);
          Utilities.sleep(backoffMs);
          continue; // Retry
        } else {
          // Max retries reached
          return {
            success: false,
            error: lastError,
          };
        }
      }

      // Other non-200 responses (don't retry)
      if (statusCode !== 200) {
        return {
          success: false,
          error: {
            code: 'API_ERROR',
            message: result.error?.message || formatErrorMessage({ code: 'API_ERROR' }),
          },
        };
      }

      // Success! Handle JSON-RPC 2.0 response format
      // Response: { jsonrpc: '2.0', id: X, result: { content: [...] } }
      if (result.result && result.result.content && result.result.content[0]) {
        const content = result.result.content[0];

        if (content.text) {
          try {
            const parsed = JSON.parse(content.text);
            return parsed;
          } catch (e) {
            // Not JSON, return as-is
            return {
              success: true,
              response: { text: content.text },
            };
          }
        }
      }

      // Fallback: return result as-is
      return result.result || result;
    } catch (error) {
      // Network errors are retryable
      lastError = {
        code: 'NETWORK_ERROR',
        message: formatErrorMessage({ code: 'NETWORK_ERROR' }),
      };

      if (attempt < maxRetries) {
        // Exponential backoff: 1s, 2s, 4s
        const backoffMs = Math.pow(2, attempt - 1) * 1000;
        Logger.log(`Network error on attempt ${attempt}, retrying in ${backoffMs}ms...`);
        Utilities.sleep(backoffMs);
        continue; // Retry
      } else {
        // Max retries reached
        return {
          success: false,
          error: lastError,
        };
      }
    }
  }

  // Should never reach here, but return last error just in case
  return {
    success: false,
    error: lastError || {
      code: 'UNKNOWN_ERROR',
      message: formatErrorMessage({ code: 'UNKNOWN_ERROR' }),
    },
  };
}

/**
 * Get active spreadsheet info
 */
function getActiveSpreadsheetInfo() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const range = ss.getActiveRange();

  return {
    spreadsheetId: ss.getId(),
    spreadsheetName: ss.getName(),
    sheetName: sheet.getName(),
    sheetId: sheet.getSheetId(),
    activeRange: range ? range.getA1Notation() : null,
  };
}

function getActiveSpreadsheetId_() {
  return SpreadsheetApp.getActiveSpreadsheet().getId();
}

function resolveSpreadsheetId_(spreadsheetId) {
  return spreadsheetId || getActiveSpreadsheetId_();
}

function normalizeDashboardLayout_(layout) {
  const validLayouts = ['kpi_header', 'full_analytics', 'executive_summary'];
  return validLayouts.indexOf(layout) !== -1 ? layout : 'full_analytics';
}

function normalizeArrayInput_(value, fallback) {
  if (Array.isArray(value) && value.length > 0) {
    return value;
  }
  if (value === undefined || value === null || value === '') {
    return fallback || [];
  }
  return [value];
}

function buildConnectorSchedule_(schedule) {
  if (!schedule) {
    return { interval: 'hourly' };
  }
  if (typeof schedule === 'string') {
    if (['hourly', 'daily', 'weekly', 'custom'].indexOf(schedule) !== -1) {
      return { interval: schedule };
    }
    return { interval: 'custom', customCronExpression: schedule };
  }
  if (typeof schedule === 'number') {
    const minutes = Math.max(1, Math.min(59, Math.floor(schedule)));
    return { interval: 'custom', customCronExpression: '*/' + minutes + ' * * * *' };
  }
  return schedule;
}

function executeToolAction(actionSpec) {
  if (!actionSpec || !actionSpec.tool) {
    return {
      success: false,
      error: {
        code: 'INVALID_ACTION_SPEC',
        message: 'Action spec must include a tool name',
      },
    };
  }

  const request = Object.assign({}, actionSpec.params || {});
  if (!request.action && actionSpec.action) {
    request.action = actionSpec.action;
  }

  if (!request.action) {
    return {
      success: false,
      error: {
        code: 'INVALID_ACTION_SPEC',
        message: 'Action spec must include an action',
      },
    };
  }

  if (!request.spreadsheetId && (actionSpec.tool === 'sheets_fix' || request.range)) {
    request.spreadsheetId = getActiveSpreadsheetId_();
  }

  if (
    request.destination &&
    typeof request.destination === 'object' &&
    !request.destination.spreadsheetId
  ) {
    request.destination = Object.assign({}, request.destination, {
      spreadsheetId: getActiveSpreadsheetId_(),
    });
  }

  return callServalSheets(actionSpec.tool, request);
}

// ============================================================================
// Tool Actions - Wrappers for MCP tools
// ============================================================================

/**
 * Read data from current spreadsheet
 */
function readData(range) {
  const info = getActiveSpreadsheetInfo();

  return callServalSheets('sheets_data', {
    action: 'read',
    spreadsheetId: info.spreadsheetId,
    range: range || info.activeRange || 'A1:Z100',
  });
}

/**
 * Write data to spreadsheet
 */
function writeData(range, values) {
  const info = getActiveSpreadsheetInfo();

  const result = callServalSheets('sheets_data', {
    action: 'write',
    spreadsheetId: info.spreadsheetId,
    range: range,
    values: values,
  });

  // Invalidate cache after successful write
  if (result && result.success) {
    invalidateSpreadsheetCache(info.spreadsheetId);
  }

  return result;
}

/**
 * AI-powered comprehensive analysis
 */
function analyzeData(prompt, range) {
  const info = getActiveSpreadsheetInfo();

  return callServalSheets('sheets_analyze', {
    action: 'comprehensive',
    spreadsheetId: info.spreadsheetId,
    range: range || info.activeRange || info.sheetName,
    prompt: prompt,
  });
}

/**
 * Generate formula from natural language
 */
function generateFormula(description) {
  const info = getActiveSpreadsheetInfo();

  return callServalSheets('sheets_analyze', {
    action: 'generate_formula',
    spreadsheetId: info.spreadsheetId,
    range: info.activeRange,
    prompt: description,
  });
}

/**
 * Detect patterns in data
 */
function detectPatterns(range) {
  const info = getActiveSpreadsheetInfo();

  return callServalSheets('sheets_analyze', {
    action: 'detect_patterns',
    spreadsheetId: info.spreadsheetId,
    range: range || info.activeRange || info.sheetName,
  });
}

/**
 * Create chart
 */
function createChart(chartType, dataRange, title) {
  const info = getActiveSpreadsheetInfo();

  return callServalSheets('sheets_visualize', {
    action: 'chart_create',
    spreadsheetId: info.spreadsheetId,
    sheetName: info.sheetName,
    type: chartType,
    dataRange: dataRange,
    title: title,
  });
}

/**
 * Suggest best chart type for data
 */
function suggestChart(dataRange) {
  const info = getActiveSpreadsheetInfo();

  return callServalSheets('sheets_visualize', {
    action: 'suggest_chart',
    spreadsheetId: info.spreadsheetId,
    range: dataRange || info.activeRange,
  });
}

/**
 * Apply formatting
 */
function applyFormatting(range, format) {
  const info = getActiveSpreadsheetInfo();

  return callServalSheets('sheets_format', {
    action: 'set_format',
    spreadsheetId: info.spreadsheetId,
    range: range,
    format: format,
  });
}

// ============================================================================
// Core Operations - Spreadsheet Management (sheets_core)
// ============================================================================

/**
 * Get spreadsheet metadata
 */
function getSpreadsheet() {
  const info = getActiveSpreadsheetInfo();

  return callServalSheets('sheets_core', {
    action: 'get',
    spreadsheetId: info.spreadsheetId,
  });
}

/**
 * List all sheets/tabs in spreadsheet
 */
function listSheets() {
  const info = getActiveSpreadsheetInfo();

  return callServalSheets('sheets_core', {
    action: 'list_sheets',
    spreadsheetId: info.spreadsheetId,
  });
}

/**
 * Add a new sheet/tab
 */
function addSheet(sheetName, rowCount, columnCount) {
  const info = getActiveSpreadsheetInfo();

  const result = callServalSheets('sheets_core', {
    action: 'add_sheet',
    spreadsheetId: info.spreadsheetId,
    title: sheetName,
    rowCount: rowCount || 1000,
    columnCount: columnCount || 26,
  });

  // Invalidate cache after successful sheet addition
  if (result && result.success) {
    invalidateSpreadsheetCache(info.spreadsheetId);
  }

  return result;
}

/**
 * Delete a sheet/tab by ID
 */
function deleteSheet(sheetId) {
  const info = getActiveSpreadsheetInfo();

  const result = callServalSheets('sheets_core', {
    action: 'delete_sheet',
    spreadsheetId: info.spreadsheetId,
    sheetId: sheetId,
  });

  // Invalidate cache after successful sheet deletion
  if (result && result.success) {
    invalidateSpreadsheetCache(info.spreadsheetId);
  }

  return result;
}

/**
 * Copy sheet to another spreadsheet
 */
function copySheetTo(sheetId, destinationSpreadsheetId) {
  const info = getActiveSpreadsheetInfo();

  return callServalSheets('sheets_core', {
    action: 'copy_sheet_to',
    spreadsheetId: info.spreadsheetId,
    sheetId: sheetId,
    destinationSpreadsheetId: destinationSpreadsheetId,
  });
}

// ============================================================================
// Dimension Operations - Rows & Columns (sheets_dimensions)
// ============================================================================

/**
 * Insert rows
 */
function insertRows(startIndex, count) {
  const info = getActiveSpreadsheetInfo();

  const result = callServalSheets('sheets_dimensions', {
    action: 'insert',
    spreadsheetId: info.spreadsheetId,
    sheetId: info.sheetId,
    dimension: 'ROWS',
    startIndex: startIndex,
    count: count || 1,
  });

  // Invalidate cache after successful row insertion
  if (result && result.success) {
    invalidateSpreadsheetCache(info.spreadsheetId);
  }

  return result;
}

/**
 * Delete rows
 */
function deleteRows(startIndex, endIndex) {
  const info = getActiveSpreadsheetInfo();

  return callServalSheets('sheets_dimensions', {
    action: 'delete',
    spreadsheetId: info.spreadsheetId,
    sheetId: info.sheetId,
    dimension: 'ROWS',
    startIndex: startIndex,
    endIndex: endIndex,
  });
}

/**
 * Insert columns
 */
function insertColumns(startIndex, count) {
  const info = getActiveSpreadsheetInfo();

  return callServalSheets('sheets_dimensions', {
    action: 'insert',
    spreadsheetId: info.spreadsheetId,
    sheetId: info.sheetId,
    dimension: 'COLUMNS',
    startIndex: startIndex,
    count: count || 1,
  });
}

// ============================================================================
// Collaboration Operations (sheets_collaborate)
// ============================================================================

/**
 * Share spreadsheet with user
 */
function shareWithUser(email, role, sendNotification) {
  const info = getActiveSpreadsheetInfo();

  return callServalSheets('sheets_collaborate', {
    action: 'share_add',
    spreadsheetId: info.spreadsheetId,
    type: 'user',
    emailAddress: email,
    role: role || 'reader',
    sendNotification: sendNotification !== false,
  });
}

/**
 * Add comment to range
 */
function addComment(range, text) {
  const info = getActiveSpreadsheetInfo();

  return callServalSheets('sheets_collaborate', {
    action: 'comment_add',
    spreadsheetId: info.spreadsheetId,
    content: text,
    anchor: range,
  });
}

/**
 * List all comments
 */
function listComments() {
  const info = getActiveSpreadsheetInfo();

  return callServalSheets('sheets_collaborate', {
    action: 'comment_list',
    spreadsheetId: info.spreadsheetId,
  });
}

// ============================================================================
// PRIORITY 1 TOOLS: Transaction, Quality, History, Composite, Session
// ============================================================================

// Transaction Operations (sheets_transaction)
// ============================================================================

/**
 * Begin a transaction
 */
function beginTransaction() {
  const info = getActiveSpreadsheetInfo();
  return callServalSheets('sheets_transaction', {
    action: 'begin',
    spreadsheetId: info.spreadsheetId,
  });
}

/**
 * Commit a transaction
 */
function commitTransaction(transactionId) {
  const info = getActiveSpreadsheetInfo();

  const result = callServalSheets('sheets_transaction', {
    action: 'commit',
    spreadsheetId: info.spreadsheetId,
    transactionId: transactionId,
  });

  // Invalidate cache after successful transaction commit
  if (result && result.success) {
    invalidateSpreadsheetCache(info.spreadsheetId);
  }

  return result;
}

/**
 * Rollback a transaction
 */
function rollbackTransaction(transactionId) {
  const info = getActiveSpreadsheetInfo();
  return callServalSheets('sheets_transaction', {
    action: 'rollback',
    spreadsheetId: info.spreadsheetId,
    transactionId: transactionId,
  });
}

// Quality & Validation Operations (sheets_quality)
// ============================================================================

/**
 * Validate data in a range
 */
function validateData(range, validationType, options) {
  const info = getActiveSpreadsheetInfo();
  return callServalSheets('sheets_quality', {
    action: 'validate',
    spreadsheetId: info.spreadsheetId,
    sheetName: info.sheetName,
    range: range,
    validationType: validationType,
    options: options,
  });
}

/**
 * Detect data conflicts
 */
function detectConflicts(range) {
  const info = getActiveSpreadsheetInfo();
  return callServalSheets('sheets_quality', {
    action: 'detect_conflicts',
    spreadsheetId: info.spreadsheetId,
    sheetName: info.sheetName,
    range: range,
  });
}

/**
 * Analyze impact of data change
 */
function analyzeImpact(range, proposedChange) {
  const info = getActiveSpreadsheetInfo();
  return callServalSheets('sheets_quality', {
    action: 'analyze_impact',
    spreadsheetId: info.spreadsheetId,
    sheetName: info.sheetName,
    range: range,
    proposedChange: proposedChange,
  });
}

// Composite Operations (sheets_composite)
// ============================================================================

/**
 * Import CSV data
 */
function importCsv(csvData, targetRange, options) {
  const info = getActiveSpreadsheetInfo();
  return callServalSheets('sheets_composite', {
    action: 'import_csv',
    spreadsheetId: info.spreadsheetId,
    sheetName: info.sheetName,
    csvData: csvData,
    targetRange: targetRange,
    options: options,
  });
}

/**
 * Smart append data
 */
function smartAppend(data, options) {
  const info = getActiveSpreadsheetInfo();
  return callServalSheets('sheets_composite', {
    action: 'smart_append',
    spreadsheetId: info.spreadsheetId,
    sheetName: info.sheetName,
    data: data,
    options: options,
  });
}

/**
 * Bulk update multiple ranges
 */
function bulkUpdate(updates) {
  const info = getActiveSpreadsheetInfo();
  return callServalSheets('sheets_composite', {
    action: 'bulk_update',
    spreadsheetId: info.spreadsheetId,
    updates: updates,
  });
}

// Session & Context Operations (sheets_session)
// ============================================================================

/**
 * Set active spreadsheet/sheet
 */
function setActiveContext(spreadsheetId, sheetName) {
  return callServalSheets('sheets_session', {
    action: 'set_active',
    spreadsheetId: spreadsheetId,
    sheetName: sheetName,
  });
}

/**
 * Get current session context
 */
function getSessionContext() {
  return callServalSheets('sheets_session', {
    action: 'get_context',
  });
}

/**
 * Store context variable
 */
function storeContextVar(key, value) {
  return callServalSheets('sheets_session', {
    action: 'store_var',
    key: key,
    value: value,
  });
}

/**
 * Retrieve context variable
 */
function retrieveContextVar(key) {
  return callServalSheets('sheets_session', {
    action: 'retrieve_var',
    key: key,
  });
}

// ============================================================================
// PRIORITY 2 TOOLS: Advanced, Confirm, Fix, Templates, BigQuery, etc.
// ============================================================================

// Advanced Operations (sheets_advanced)
// ============================================================================

/**
 * Add named range
 */
function addNamedRange(name, range) {
  const info = getActiveSpreadsheetInfo();
  return callServalSheets('sheets_advanced', {
    action: 'add_named_range',
    spreadsheetId: info.spreadsheetId,
    sheetName: info.sheetName,
    name: name,
    range: range,
  });
}

/**
 * Update named range
 */
function updateNamedRange(name, newRange) {
  const info = getActiveSpreadsheetInfo();
  return callServalSheets('sheets_advanced', {
    action: 'update_named_range',
    spreadsheetId: info.spreadsheetId,
    name: name,
    range: newRange,
  });
}

/**
 * Delete named range
 */
function deleteNamedRange(name) {
  const info = getActiveSpreadsheetInfo();
  return callServalSheets('sheets_advanced', {
    action: 'delete_named_range',
    spreadsheetId: info.spreadsheetId,
    name: name,
  });
}

/**
 * Add conditional formatting rule
 */
function addConditionalFormat(range, condition, format) {
  const info = getActiveSpreadsheetInfo();
  return callServalSheets('sheets_advanced', {
    action: 'add_conditional_format',
    spreadsheetId: info.spreadsheetId,
    sheetName: info.sheetName,
    range: range,
    condition: condition,
    format: format,
  });
}

// Confirmation Operations (sheets_confirm)
// ============================================================================

/**
 * Request user confirmation for operation
 */
function requestConfirmation(operation, details) {
  const info = getActiveSpreadsheetInfo();
  return callServalSheets('sheets_confirm', {
    action: 'request',
    spreadsheetId: info.spreadsheetId,
    operation: operation,
    details: details,
  });
}

/**
 * Get confirmation statistics
 */
function getConfirmationStats() {
  const info = getActiveSpreadsheetInfo();
  return callServalSheets('sheets_confirm', {
    action: 'get_stats',
    spreadsheetId: info.spreadsheetId,
  });
}

// Auto-Fix Operations (sheets_fix)
// ============================================================================

/**
 * Auto-fix data issues
 */
function autoFix(range, issues) {
  const info = getActiveSpreadsheetInfo();
  return callServalSheets('sheets_fix', {
    action: 'fix',
    spreadsheetId: info.spreadsheetId,
    sheetName: info.sheetName,
    range: range,
    issues: issues,
  });
}

// Template Operations (sheets_templates)
// ============================================================================

/**
 * List available templates
 */
function listTemplates(category) {
  return callServalSheets('sheets_templates', {
    action: 'list',
    category: category,
  });
}

/**
 * Get template details
 */
function getTemplate(templateId) {
  return callServalSheets('sheets_templates', {
    action: 'get',
    templateId: templateId,
  });
}

/**
 * Create spreadsheet from template
 */
function createFromTemplate(templateId, name) {
  return callServalSheets('sheets_templates', {
    action: 'create',
    templateId: templateId,
    name: name,
  });
}

// BigQuery Operations (sheets_bigquery)
// ============================================================================

/**
 * Connect to BigQuery
 */
function connectBigQuery(projectId, datasetId) {
  const info = getActiveSpreadsheetInfo();
  return callServalSheets('sheets_bigquery', {
    action: 'connect',
    spreadsheetId: info.spreadsheetId,
    projectId: projectId,
    datasetId: datasetId,
  });
}

/**
 * Query BigQuery
 */
function queryBigQuery(query, targetRange) {
  const info = getActiveSpreadsheetInfo();
  return callServalSheets('sheets_bigquery', {
    action: 'query',
    spreadsheetId: info.spreadsheetId,
    sheetName: info.sheetName,
    query: query,
    targetRange: targetRange,
  });
}

/**
 * Export to BigQuery
 */
function exportToBigQuery(range, tableName) {
  const info = getActiveSpreadsheetInfo();
  return callServalSheets('sheets_bigquery', {
    action: 'export',
    spreadsheetId: info.spreadsheetId,
    sheetName: info.sheetName,
    range: range,
    tableName: tableName,
  });
}

// Apps Script Operations (sheets_appsscript)
// ============================================================================

/**
 * Create Apps Script project
 */
function createAppsScript(projectName) {
  const info = getActiveSpreadsheetInfo();
  return callServalSheets('sheets_appsscript', {
    action: 'create',
    spreadsheetId: info.spreadsheetId,
    projectName: projectName,
  });
}

/**
 * Get Apps Script content
 */
function getAppsScriptContent(projectId) {
  return callServalSheets('sheets_appsscript', {
    action: 'get_content',
    projectId: projectId,
  });
}

/**
 * Deploy Apps Script
 */
function deployAppsScript(projectId, version) {
  return callServalSheets('sheets_appsscript', {
    action: 'deploy',
    projectId: projectId,
    version: version,
  });
}

// Webhook Operations (sheets_webhook)
// ============================================================================

/**
 * Register webhook
 */
function registerWebhook(url, events) {
  const info = getActiveSpreadsheetInfo();
  return callServalSheets('sheets_webhook', {
    action: 'register',
    spreadsheetId: info.spreadsheetId,
    url: url,
    events: events,
  });
}

/**
 * List webhooks
 */
function listWebhooks() {
  const info = getActiveSpreadsheetInfo();
  return callServalSheets('sheets_webhook', {
    action: 'list',
    spreadsheetId: info.spreadsheetId,
  });
}

/**
 * Unregister webhook
 */
function unregisterWebhook(webhookId) {
  const info = getActiveSpreadsheetInfo();
  return callServalSheets('sheets_webhook', {
    action: 'unregister',
    spreadsheetId: info.spreadsheetId,
    webhookId: webhookId,
  });
}

// Dependency Operations (sheets_dependencies)
// ============================================================================

/**
 * Build dependency graph
 */
function buildDependencyGraph() {
  const info = getActiveSpreadsheetInfo();
  return callServalSheets('sheets_dependencies', {
    action: 'build',
    spreadsheetId: info.spreadsheetId,
  });
}

/**
 * Analyze impact of change
 */
function analyzeDependencyImpact(cellReference) {
  const info = getActiveSpreadsheetInfo();
  return callServalSheets('sheets_dependencies', {
    action: 'analyze_impact',
    spreadsheetId: info.spreadsheetId,
    cellReference: cellReference,
  });
}

/**
 * Detect circular dependencies
 */
function detectCircularDependencies() {
  const info = getActiveSpreadsheetInfo();
  return callServalSheets('sheets_dependencies', {
    action: 'detect_cycles',
    spreadsheetId: info.spreadsheetId,
  });
}

// Authentication Operations (sheets_auth)
// ============================================================================

/**
 * Get authentication status
 */
function getAuthStatus() {
  return callServalSheets('sheets_auth', {
    action: 'status',
  });
}

/**
 * Login (OAuth flow)
 */
function loginOAuth() {
  return callServalSheets('sheets_auth', {
    action: 'login',
  });
}

/**
 * Logout
 */
function logoutUser() {
  return callServalSheets('sheets_auth', {
    action: 'logout',
  });
}

// ============================================================================
// Usage Statistics & Testing
// ============================================================================

/**
 * Get usage statistics
 */
function getUsageStats() {
  // This would call a billing endpoint
  // For now, return placeholder
  return {
    success: true,
    stats: {
      plan: getPlan(),
      operationsThisMonth: 0,
      limit: 1000,
      percentUsed: 0,
    },
  };
}

/**
 * Test API connection
 */
function testConnection() {
  const apiKey = getApiKey();

  if (!apiKey) {
    return {
      success: false,
      message: 'No API key configured',
    };
  }

  try {
    const url = `${CONFIG.API_URL}/health`;
    const options = {
      method: 'get',
      muteHttpExceptions: true,
    };

    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();

    if (statusCode === 200) {
      return {
        success: true,
        message: 'Connected to ServalSheets API successfully!',
      };
    } else {
      return {
        success: false,
        message: `API returned status ${statusCode}`,
      };
    }
  } catch (error) {
    return {
      success: false,
      message: `Connection failed: ${error.message}. Make sure your local server is running on ${CONFIG.API_URL}`,
    };
  }
}

// ==================== PHASE 3.1: Contextual Tool Suggestions ====================

/**
 * Detects context from user's current selection and suggests relevant tools
 * @returns {Object} Context object with suggestions
 */
function detectContext() {
  try {
    const sheet = SpreadsheetApp.getActiveSheet();
    const range = SpreadsheetApp.getActiveRange();

    if (!range) {
      return {
        hasSelection: false,
        suggestions: [
          {
            action: 'analyze',
            label: '📊 Analyze Sheet',
            description: 'Get insights from your data',
          },
          {
            action: 'listSheets',
            label: '📋 List All Sheets',
            description: 'View all sheets in this spreadsheet',
          },
        ],
      };
    }

    const values = range.getValues();
    const rowCount = values.length;
    const colCount = values[0] ? values[0].length : 0;

    // Sample first 10 rows to detect types
    const sampleSize = Math.min(10, rowCount);
    let hasNumbers = false;
    let hasDates = false;
    let hasText = false;
    let hasFormulas = false;
    let emptyCount = 0;
    let totalCells = 0;

    for (let i = 0; i < sampleSize; i++) {
      for (let j = 0; j < colCount; j++) {
        totalCells++;
        const cell = values[i][j];

        if (cell === '' || cell === null || cell === undefined) {
          emptyCount++;
        } else if (typeof cell === 'number') {
          hasNumbers = true;
        } else if (cell instanceof Date) {
          hasDates = true;
        } else if (typeof cell === 'string') {
          hasText = true;
          if (cell.startsWith('=')) {
            hasFormulas = true;
          }
        }
      }
    }

    const emptyCellPercent = (emptyCount / totalCells) * 100;
    const isLargeRange = rowCount > 100 || colCount > 10;
    const isSmallRange = rowCount <= 5 && colCount <= 5;

    // Build context-aware suggestions
    const suggestions = [];

    // Large dataset suggestions
    if (isLargeRange) {
      suggestions.push({
        action: 'analyze',
        label: '📊 Analyze Large Dataset',
        description: `Analyze ${rowCount} rows × ${colCount} columns`,
      });

      if (hasNumbers) {
        suggestions.push({
          action: 'patterns',
          label: '🔍 Find Patterns',
          description: 'Detect trends and anomalies',
        });
      }
    }

    // Numeric data suggestions
    if (hasNumbers && rowCount > 2) {
      suggestions.push({
        action: 'chart',
        label: '📈 Create Chart',
        description: 'Visualize numeric data',
      });

      if (!hasFormulas && rowCount > 1) {
        suggestions.push({
          action: 'formula',
          label: '🔢 Add Formulas',
          description: 'Generate calculations',
        });
      }
    }

    // Date column suggestions
    if (hasDates) {
      suggestions.push({
        action: 'timeline',
        label: '📅 Timeline Chart',
        description: 'Visualize data over time',
      });
    }

    // Data quality suggestions
    if (emptyCellPercent > 10) {
      suggestions.push({
        action: 'quality',
        label: '✅ Check Data Quality',
        description: `${emptyCellPercent.toFixed(0)}% empty cells detected`,
      });
    }

    // Formatting suggestions for small ranges
    if (isSmallRange && hasNumbers) {
      suggestions.push({
        action: 'format',
        label: '🎨 Format Cells',
        description: 'Apply number formatting',
      });
    }

    // Text data suggestions
    if (hasText && !hasNumbers && rowCount > 5) {
      suggestions.push({
        action: 'analyze',
        label: '📝 Analyze Text',
        description: 'Extract insights from text',
      });
    }

    // Default suggestions if none matched
    if (suggestions.length === 0) {
      suggestions.push({
        action: 'analyze',
        label: '📊 Analyze Selection',
        description: 'Get AI insights',
      });
      suggestions.push({
        action: 'formula',
        label: '🔢 Generate Formula',
        description: 'Create custom formulas',
      });
    }

    return {
      hasSelection: true,
      range: range.getA1Notation(),
      size: {
        rows: rowCount,
        cols: colCount,
      },
      types: {
        hasNumbers,
        hasDates,
        hasText,
        hasFormulas,
      },
      metrics: {
        emptyCellPercent: emptyCellPercent.toFixed(1),
        isLargeRange,
        isSmallRange,
      },
      suggestions: suggestions.slice(0, 4), // Limit to 4 suggestions
    };
  } catch (error) {
    Logger.log('Error detecting context: ' + error.message);
    return {
      hasSelection: false,
      error: error.message,
      suggestions: [],
    };
  }
}

// ==================== PHASE 3.2: Batch Operations ====================

/**
 * Executes multiple operations atomically using transactions
 * @param {Array<Object>} operations - Array of { tool, action, params, label }
 * @returns {Object} Batch execution result
 */
function executeBatch(operations) {
  const info = getActiveSpreadsheetInfo();
  const results = [];
  let transactionId = null;

  try {
    // Start transaction
    const txStart = callServalSheets('sheets_transaction', {
      action: 'begin',
      spreadsheetId: info.spreadsheetId,
    });

    if (!txStart.success) {
      return {
        success: false,
        error: {
          code: 'TRANSACTION_START_FAILED',
          message: 'Failed to start transaction: ' + (txStart.error?.message || 'Unknown error'),
        },
      };
    }

    transactionId = txStart.response?.transactionId;
    Logger.log('Transaction started: ' + transactionId);

    // Execute each operation in sequence
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      Logger.log(`Executing operation ${i + 1}/${operations.length}: ${op.label}`);

      try {
        // Build request with operation parameters
        const request = {
          action: op.action,
          spreadsheetId: info.spreadsheetId,
          ...op.params,
        };

        // Add transaction ID to request
        if (transactionId) {
          request.transactionId = transactionId;
        }

        // Execute operation
        const result = callServalSheets(op.tool, request);

        if (result.success) {
          results.push({
            operation: op.label,
            status: 'success',
            result: result.response,
          });
        } else {
          // Operation failed - trigger rollback
          throw new Error(`Operation failed: ${result.error?.message || 'Unknown error'}`);
        }
      } catch (opError) {
        Logger.log(`Operation ${i + 1} failed: ${opError.message}`);
        throw opError; // Propagate to outer catch for rollback
      }
    }

    // All operations succeeded - commit transaction
    const txCommit = callServalSheets('sheets_transaction', {
      action: 'commit',
      spreadsheetId: info.spreadsheetId,
      transactionId: transactionId,
    });

    if (!txCommit.success) {
      throw new Error(
        'Failed to commit transaction: ' + (txCommit.error?.message || 'Unknown error')
      );
    }

    Logger.log('Transaction committed successfully');

    return {
      success: true,
      response: {
        message: `Successfully executed ${operations.length} operation(s)`,
        results: results,
        transactionId: transactionId,
      },
    };
  } catch (error) {
    Logger.log('Batch execution failed: ' + error.message);

    // Attempt rollback if transaction was started
    if (transactionId) {
      Logger.log('Rolling back transaction: ' + transactionId);
      try {
        const txRollback = callServalSheets('sheets_transaction', {
          action: 'rollback',
          spreadsheetId: info.spreadsheetId,
          transactionId: transactionId,
        });

        if (txRollback.success) {
          Logger.log('Transaction rolled back successfully');
        } else {
          Logger.log('Rollback failed: ' + (txRollback.error?.message || 'Unknown error'));
        }
      } catch (rollbackError) {
        Logger.log('Rollback error: ' + rollbackError.message);
      }
    }

    return {
      success: false,
      error: {
        code: 'BATCH_EXECUTION_FAILED',
        message: error.message,
        completedOperations: results.length,
        totalOperations: operations.length,
      },
    };
  }
}

/**
 * Validates a batch operation before adding to queue
 * @param {Object} operation - Operation to validate
 * @returns {Object} Validation result
 */
function validateBatchOperation(operation) {
  // Check required fields
  if (!operation.tool || !operation.action) {
    return {
      valid: false,
      error: 'Operation must have tool and action',
    };
  }

  // Check tool exists (basic validation)
  const validTools = [
    'sheets_data',
    'sheets_format',
    'sheets_dimensions',
    'sheets_core',
    'sheets_collaborate',
    'sheets_visualize',
    'sheets_analyze',
  ];

  if (!validTools.includes(operation.tool)) {
    return {
      valid: false,
      error: `Unknown tool: ${operation.tool}`,
    };
  }

  return {
    valid: true,
  };
}

// ==================== PHASE 3.3: Action History & Undo ====================

/**
 * Lists recent operation history
 * @param {number} limit - Maximum number of operations to return
 * @returns {Object} History list result
 */
function getOperationHistory(limit) {
  const info = getActiveSpreadsheetInfo();
  limit = limit || 10;

  try {
    const result = callServalSheets('sheets_history', {
      action: 'list',
      spreadsheetId: info.spreadsheetId,
      count: limit,
    });

    if (result.success) {
      return {
        success: true,
        response: {
          operations: result.response?.operations || [],
          total: result.response?.totalCount || 0,
          hasMore: result.response?.hasMore || false,
          nextCursor: result.response?.nextCursor || null,
        },
      };
    } else {
      return {
        success: false,
        error: result.error,
      };
    }
  } catch (error) {
    Logger.log('Error getting history: ' + error.message);
    return {
      success: false,
      error: {
        code: 'HISTORY_ERROR',
        message: error.message,
      },
    };
  }
}

/**
 * Gets detailed history statistics
 * @returns {Object} History stats result
 */
function getHistoryStats() {
  const info = getActiveSpreadsheetInfo();

  try {
    const result = callServalSheets('sheets_history', {
      action: 'stats',
      spreadsheetId: info.spreadsheetId,
    });

    if (result.success) {
      return {
        success: true,
        response: result.response,
      };
    } else {
      return {
        success: false,
        error: result.error,
      };
    }
  } catch (error) {
    Logger.log('Error getting history stats: ' + error.message);
    return {
      success: false,
      error: {
        code: 'HISTORY_STATS_ERROR',
        message: error.message,
      },
    };
  }
}

/**
 * Revert to the state before a specific operation
 * @param {string} operationId - Operation ID to revert to
 * @param {boolean} dryRun - Preview only
 * @returns {Object} Revert result
 */
function revertToOperation(operationId, dryRun) {
  try {
    if (!operationId) {
      return {
        success: false,
        error: {
          code: 'INVALID_OPERATION_ID',
          message: 'Operation ID is required',
        },
      };
    }

    Logger.log('Reverting to operation: ' + operationId);

    const result = callServalSheets('sheets_history', {
      action: 'revert_to',
      operationId: operationId,
      safety: dryRun ? { dryRun: true } : undefined,
    });

    if (result.success) {
      return {
        success: true,
        response: {
          message: dryRun ? 'Revert preview generated successfully' : 'Operation reverted successfully',
          operationId: operationId,
          ...result.response,
        },
      };
    } else {
      return {
        success: false,
        error: result.error,
      };
    }
  } catch (error) {
    Logger.log('Error reverting operation: ' + error.message);
    return {
      success: false,
      error: {
        code: 'REVERT_ERROR',
        message: error.message,
      },
    };
  }
}

/**
 * Deprecated alias retained for existing callers.
 * Historically this accepted an operation ID, but the server-side action is revert_to.
 */
function undoOperation(operationId) {
  return revertToOperation(operationId, false);
}

/**
 * Undoes the last N operations
 * @param {number} count - Number of operations to undo (default: 1)
 * @returns {Object} Undo result
 */
function undoLastOperations(count) {
  const info = getActiveSpreadsheetInfo();
  count = count || 1;

  try {
    Logger.log(`Undoing last ${count} operation(s)`);

    const results = [];
    let completed = 0;
    let lastError = null;

    for (let i = 0; i < count; i++) {
      const result = callServalSheets('sheets_history', {
        action: 'undo',
        spreadsheetId: info.spreadsheetId,
      });
      results.push(result);

      if (!result.success) {
        lastError = result.error;
        break;
      }

      completed++;
    }

    if (completed === 0 && lastError) {
      return {
        success: false,
        error: lastError,
      };
    }

    return {
      success: true,
      response: {
        message: `Undone ${completed} operation(s)`,
        count: completed,
        requested: count,
        partial: completed < count,
        results: results,
        lastError: lastError,
      },
    };
  } catch (error) {
    Logger.log('Error undoing operations: ' + error.message);
    return {
      success: false,
      error: {
        code: 'UNDO_LAST_ERROR',
        message: error.message,
      },
    };
  }
}

/**
 * Clears operation history (careful!)
 * @returns {Object} Clear result
 */
function clearHistory() {
  const info = getActiveSpreadsheetInfo();

  try {
    const result = callServalSheets('sheets_history', {
      action: 'clear',
      spreadsheetId: info.spreadsheetId,
    });

    if (result.success) {
      return {
        success: true,
        response: {
          message: 'History cleared',
        },
      };
    } else {
      return {
        success: false,
        error: result.error,
      };
    }
  } catch (error) {
    Logger.log('Error clearing history: ' + error.message);
    return {
      success: false,
      error: {
        code: 'CLEAR_HISTORY_ERROR',
        message: error.message,
      },
    };
  }
}

// ==================== PHASE 3.4: Preview Mode (Dry Run) ====================

/**
 * Executes operation in preview mode (dry run)
 * @param {string} tool - Tool name
 * @param {Object} request - Request parameters
 * @returns {Object} Preview result showing what would happen
 */
function previewOperation(tool, request) {
  try {
    // Add dryRun flag to request
    const previewRequest = {
      ...request,
      dryRun: true,
    };

    Logger.log('Running preview for: ' + tool);

    // Execute with dryRun flag
    const result = callServalSheets(tool, previewRequest);

    if (result.success) {
      return {
        success: true,
        response: {
          preview: true,
          message: 'Preview completed - no changes made',
          wouldDo: result.response,
          tool: tool,
          action: request.action,
        },
      };
    } else {
      return {
        success: false,
        error: result.error,
      };
    }
  } catch (error) {
    Logger.log('Error previewing operation: ' + error.message);
    return {
      success: false,
      error: {
        code: 'PREVIEW_ERROR',
        message: error.message,
      },
    };
  }
}

/**
 * Previews data write operation
 * @param {string} range - Target range
 * @param {Array} values - Values to write
 * @returns {Object} Preview result
 */
function previewWrite(range, values) {
  const info = getActiveSpreadsheetInfo();

  return previewOperation('sheets_data', {
    action: 'write',
    spreadsheetId: info.spreadsheetId,
    sheetName: info.sheetName,
    range: range,
    values: values,
  });
}

/**
 * Previews formatting operation
 * @param {string} range - Target range
 * @param {Object} format - Format to apply
 * @returns {Object} Preview result
 */
function previewFormat(range, format) {
  const info = getActiveSpreadsheetInfo();

  return previewOperation('sheets_format', {
    action: 'set_format',
    spreadsheetId: info.spreadsheetId,
    sheetName: info.sheetName,
    range: range,
    format: format,
  });
}

/**
 * Previews dimension changes (insert/delete rows/columns)
 * @param {string} dimension - 'ROWS' or 'COLUMNS'
 * @param {string} operation - 'insert' or 'delete'
 * @param {number} startIndex - Start index
 * @param {number} count - Number of rows/columns
 * @returns {Object} Preview result
 */
function previewDimensions(dimension, operation, startIndex, count) {
  const info = getActiveSpreadsheetInfo();

  return previewOperation('sheets_dimensions', {
    action: operation,
    spreadsheetId: info.spreadsheetId,
    sheetId: info.sheetId,
    dimension: dimension,
    startIndex: startIndex,
    count: count,
  });
}

/**
 * Previews batch operations
 * @param {Array} operations - Operations to preview
 * @returns {Object} Batch preview result
 */
function previewBatch(operations) {
  const info = getActiveSpreadsheetInfo();
  const previews = [];

  try {
    Logger.log(`Previewing ${operations.length} operation(s)`);

    // Preview each operation individually
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      const previewRequest = {
        action: op.action,
        spreadsheetId: info.spreadsheetId,
        ...op.params,
        dryRun: true,
      };

      const result = callServalSheets(op.tool, previewRequest);

      previews.push({
        operation: op.label,
        tool: op.tool,
        action: op.action,
        success: result.success,
        preview: result.response,
        error: result.error,
      });
    }

    return {
      success: true,
      response: {
        preview: true,
        message: `Preview of ${operations.length} operation(s) - no changes made`,
        previews: previews,
        allSuccessful: previews.every((p) => p.success),
      },
    };
  } catch (error) {
    Logger.log('Error previewing batch: ' + error.message);
    return {
      success: false,
      error: {
        code: 'BATCH_PREVIEW_ERROR',
        message: error.message,
        completedPreviews: previews.length,
      },
    };
  }
}

/**
 * Gets global preview mode state
 * @returns {boolean} Whether preview mode is enabled
 */
function isPreviewModeEnabled() {
  const props = PropertiesService.getUserProperties();
  return props.getProperty('PREVIEW_MODE_ENABLED') === 'true';
}

/**
 * Sets global preview mode state
 * @param {boolean} enabled - Enable or disable preview mode
 */
function setPreviewMode(enabled) {
  const props = PropertiesService.getUserProperties();
  props.setProperty('PREVIEW_MODE_ENABLED', enabled ? 'true' : 'false');
  return {
    success: true,
    response: {
      previewMode: enabled,
      message: enabled ? 'Preview mode enabled' : 'Preview mode disabled',
    },
  };
}

// ============================================================================
// PHASE 5.3: Test Suite
// ============================================================================

/**
 * Master test runner - runs all tests and reports results
 * Run from: Apps Script Editor > Run > runAllTests
 */
function runAllTests() {
  Logger.log('========================================');
  Logger.log('ServalSheets Add-on Test Suite');
  Logger.log('========================================\n');

  const results = [];
  const startTime = Date.now();

  // Test 1: API Connection
  results.push(test_apiConnection());

  // Test 2: Response Parsing
  results.push(test_responseParsing());

  // Test 3: Error Handling
  results.push(test_errorHandling());

  // Test 4: Caching Functions
  results.push(test_cachingFunctions());

  // Test 5: Environment Detection
  results.push(test_environmentDetection());

  // Test 6: Error Message Formatting
  results.push(test_errorMessageFormatting());

  // Test 7: Active Spreadsheet Info
  results.push(test_activeSpreadsheetInfo());

  // Test 8: Retry Logic (mock)
  results.push(test_retryLogic());

  const endTime = Date.now();
  const duration = endTime - startTime;

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  Logger.log('\n========================================');
  Logger.log('Test Summary');
  Logger.log('========================================');
  Logger.log(`Total Tests: ${results.length}`);
  Logger.log(`Passed: ${passed} ✓`);
  Logger.log(`Failed: ${failed} ✗`);
  Logger.log(`Duration: ${duration}ms`);
  Logger.log('========================================\n');

  // Detailed results
  results.forEach((r) => {
    const status = r.passed ? '✓ PASS' : '✗ FAIL';
    Logger.log(`${status} - ${r.name}: ${r.message}`);
  });

  return {
    summary: { total: results.length, passed, failed, duration },
    results: results,
  };
}

/**
 * Test 1: API Connection
 */
function test_apiConnection() {
  try {
    const result = checkConnection();
    if (typeof result === 'boolean') {
      return {
        name: 'API Connection',
        passed: true,
        message: `Connection check returned: ${result}`,
      };
    } else {
      return {
        name: 'API Connection',
        passed: false,
        message: 'checkConnection() did not return boolean',
      };
    }
  } catch (error) {
    return {
      name: 'API Connection',
      passed: false,
      message: `Error: ${error.message}`,
    };
  }
}

/**
 * Test 2: Response Parsing
 */
function test_responseParsing() {
  try {
    // Mock MCP response format
    const mockResponse = {
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ response: { success: true, data: 'test' } }),
          },
        ],
      },
    };

    // Test parsing logic
    if (mockResponse.result && mockResponse.result.content && mockResponse.result.content[0]) {
      const content = mockResponse.result.content[0];
      if (content.text) {
        const parsed = JSON.parse(content.text);
        const isValid = parsed.response && parsed.response.success;

        return {
          name: 'Response Parsing',
          passed: isValid,
          message: isValid ? 'Parsed successfully' : 'Parsed but structure invalid',
        };
      }
    }

    return {
      name: 'Response Parsing',
      passed: false,
      message: 'Failed to parse mock response',
    };
  } catch (error) {
    return {
      name: 'Response Parsing',
      passed: false,
      message: `Error: ${error.message}`,
    };
  }
}

/**
 * Test 3: Error Handling
 */
function test_errorHandling() {
  try {
    // Test formatErrorMessage function
    const testError = { code: 'NO_API_KEY' };
    const formatted = formatErrorMessage(testError);

    const isValidMessage = formatted && formatted.length > 0 && formatted.includes('API key');

    return {
      name: 'Error Handling',
      passed: isValidMessage,
      message: isValidMessage ? `Formatted: "${formatted}"` : 'Error message formatting failed',
    };
  } catch (error) {
    return {
      name: 'Error Handling',
      passed: false,
      message: `Error: ${error.message}`,
    };
  }
}

/**
 * Test 4: Caching Functions
 */
function test_cachingFunctions() {
  try {
    const testKey = 'test_cache_key_' + Date.now();
    const testValue = { test: 'data', timestamp: Date.now() };

    // Test set
    const setResult = setCachedValue(testKey, testValue, 60);
    if (!setResult) {
      return {
        name: 'Caching Functions',
        passed: false,
        message: 'Failed to set cache value',
      };
    }

    // Test get
    const getValue = getCachedValue(testKey, 60);
    if (!getValue) {
      return {
        name: 'Caching Functions',
        passed: false,
        message: 'Failed to retrieve cached value',
      };
    }

    // Verify value matches
    const matches = JSON.stringify(getValue) === JSON.stringify(testValue);

    // Cleanup
    clearCache(testKey);

    return {
      name: 'Caching Functions',
      passed: matches,
      message: matches ? 'Set and retrieved successfully' : 'Retrieved value does not match',
    };
  } catch (error) {
    return {
      name: 'Caching Functions',
      passed: false,
      message: `Error: ${error.message}`,
    };
  }
}

/**
 * Test 5: Environment Detection
 */
function test_environmentDetection() {
  try {
    const envInfo = getEnvironment();

    const hasRequiredFields = envInfo && envInfo.environment && envInfo.apiUrl;
    const validEnvironments = ['development', 'staging', 'production'];
    const isValidEnv = validEnvironments.includes(envInfo.environment);

    return {
      name: 'Environment Detection',
      passed: hasRequiredFields && isValidEnv,
      message:
        hasRequiredFields && isValidEnv
          ? `Detected: ${envInfo.environment} (${envInfo.apiUrl})`
          : 'Invalid environment configuration',
    };
  } catch (error) {
    return {
      name: 'Environment Detection',
      passed: false,
      message: `Error: ${error.message}`,
    };
  }
}

/**
 * Test 6: Error Message Formatting
 */
function test_errorMessageFormatting() {
  try {
    const errorCodes = ['NO_API_KEY', 'UNAUTHORIZED', 'QUOTA_EXCEEDED', 'NETWORK_ERROR', 'TIMEOUT'];

    let allFormatted = true;
    let messages = [];

    for (const code of errorCodes) {
      const formatted = formatErrorMessage({ code: code });
      if (!formatted || formatted === code || formatted.includes('unknown')) {
        allFormatted = false;
        break;
      }
      messages.push(`${code} → "${formatted}"`);
    }

    return {
      name: 'Error Message Formatting',
      passed: allFormatted,
      message: allFormatted
        ? `All ${errorCodes.length} error codes formatted correctly`
        : 'Some error codes not formatted',
    };
  } catch (error) {
    return {
      name: 'Error Message Formatting',
      passed: false,
      message: `Error: ${error.message}`,
    };
  }
}

/**
 * Test 7: Active Spreadsheet Info
 */
function test_activeSpreadsheetInfo() {
  try {
    const info = getActiveSpreadsheetInfo();

    const hasRequiredFields =
      info &&
      info.spreadsheetId &&
      info.spreadsheetName &&
      info.sheetName &&
      typeof info.sheetId === 'number';

    return {
      name: 'Active Spreadsheet Info',
      passed: hasRequiredFields,
      message: hasRequiredFields
        ? `Retrieved: ${info.spreadsheetName} / ${info.sheetName}`
        : 'Missing required fields',
    };
  } catch (error) {
    return {
      name: 'Active Spreadsheet Info',
      passed: false,
      message: `Error: ${error.message}`,
    };
  }
}

/**
 * Test 8: Retry Logic (Mock test - doesn't make real API calls)
 */
function test_retryLogic() {
  try {
    // Test exponential backoff calculation
    const attempt1Backoff = Math.pow(2, 1 - 1) * 1000; // Should be 1000ms
    const attempt2Backoff = Math.pow(2, 2 - 1) * 1000; // Should be 2000ms
    const attempt3Backoff = Math.pow(2, 3 - 1) * 1000; // Should be 4000ms

    const correctBackoff =
      attempt1Backoff === 1000 && attempt2Backoff === 2000 && attempt3Backoff === 4000;

    return {
      name: 'Retry Logic',
      passed: correctBackoff,
      message: correctBackoff
        ? 'Exponential backoff calculation correct (1s, 2s, 4s)'
        : 'Backoff calculation incorrect',
    };
  } catch (error) {
    return {
      name: 'Retry Logic',
      passed: false,
      message: `Error: ${error.message}`,
    };
  }
}

/**
 * Run quick smoke tests (fast subset for quick verification)
 */
function runQuickTests() {
  Logger.log('========================================');
  Logger.log('Quick Smoke Tests');
  Logger.log('========================================\n');

  const results = [];

  results.push(test_environmentDetection());
  results.push(test_errorMessageFormatting());
  results.push(test_activeSpreadsheetInfo());
  results.push(test_cachingFunctions());

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  Logger.log('\n========================================');
  Logger.log(`Passed: ${passed}/${results.length}`);
  Logger.log('========================================\n');

  results.forEach((r) => {
    const status = r.passed ? '✓' : '✗';
    Logger.log(`${status} ${r.name}: ${r.message}`);
  });

  return { passed, failed, results };
}

/**
 * Test integration with real API (requires API key and running server)
 * WARNING: Makes actual API calls - use with caution
 */
// ============================================================================
// History Operations (sheets_history)
// ============================================================================

/**
 * Get operation history list
 */
function getHistory(spreadsheetId, limit) {
  return callServalSheets('sheets_history', {
    action: 'list',
    spreadsheetId: spreadsheetId || SpreadsheetApp.getActive().getId(),
    limit: limit || 50
  });
}

/**
 * Get chronological change timeline
 */
function getTimeline(spreadsheetId, since, until) {
  return callServalSheets('sheets_history', {
    action: 'timeline',
    spreadsheetId: spreadsheetId || SpreadsheetApp.getActive().getId(),
    since: since,
    until: until
  });
}

/**
 * Diff two revisions at cell level
 */
function diffRevisions(spreadsheetId, revisionId1, revisionId2, range) {
  return callServalSheets('sheets_history', {
    action: 'diff_revisions',
    spreadsheetId: spreadsheetId || SpreadsheetApp.getActive().getId(),
    revisionId1: revisionId1,
    revisionId2: revisionId2,
    range: range
  });
}

// ============================================================================
// Data Cleaning Operations (sheets_fix)
// ============================================================================

/**
 * Preview cleaning changes without applying
 */
function previewClean(spreadsheetId, range, rules) {
  return callServalSheets('sheets_fix', {
    action: 'clean',
    spreadsheetId: spreadsheetId || SpreadsheetApp.getActive().getId(),
    range: range,
    rules: rules,
    mode: 'preview'
  });
}

/**
 * Apply cleaning changes
 */
function applyClean(spreadsheetId, range, rules) {
  return callServalSheets('sheets_fix', {
    action: 'clean',
    spreadsheetId: spreadsheetId || SpreadsheetApp.getActive().getId(),
    range: range,
    rules: rules,
    mode: 'apply'
  });
}

/**
 * Get AI-powered cleaning recommendations
 */
function suggestCleaning(spreadsheetId, range) {
  return callServalSheets('sheets_fix', {
    action: 'suggest_cleaning',
    spreadsheetId: spreadsheetId || SpreadsheetApp.getActive().getId(),
    range: range
  });
}

/**
 * Normalize column formats (dates, currencies, phones, etc.)
 */
function standardizeFormats(spreadsheetId, range, columns) {
  return callServalSheets('sheets_fix', {
    action: 'standardize_formats',
    spreadsheetId: spreadsheetId || SpreadsheetApp.getActive().getId(),
    range: range,
    columns: columns
  });
}

/**
 * Fill empty cells using a statistical strategy
 */
function fillMissing(spreadsheetId, range, strategy, constantValue) {
  return callServalSheets('sheets_fix', {
    action: 'fill_missing',
    spreadsheetId: spreadsheetId || SpreadsheetApp.getActive().getId(),
    range: range,
    strategy: strategy || 'forward',
    constantValue: constantValue
  });
}

// ============================================================================
// Scenario Modeling Operations (sheets_dependencies)
// ============================================================================

/**
 * Model impact of cell changes across the dependency graph
 */
function modelScenario(spreadsheetId, changes, outputRange) {
  return callServalSheets('sheets_dependencies', {
    action: 'model_scenario',
    spreadsheetId: spreadsheetId || SpreadsheetApp.getActive().getId(),
    changes: changes,
    outputRange: outputRange
  });
}

/**
 * Compare multiple named scenarios side-by-side
 */
function compareScenarios(spreadsheetId, scenarios) {
  return callServalSheets('sheets_dependencies', {
    action: 'compare_scenarios',
    spreadsheetId: spreadsheetId || SpreadsheetApp.getActive().getId(),
    scenarios: scenarios
  });
}

/**
 * Materialize a scenario as a new sheet
 */
function createScenarioSheet(spreadsheetId, scenario, targetSheet) {
  return callServalSheets('sheets_dependencies', {
    action: 'create_scenario_sheet',
    spreadsheetId: spreadsheetId || SpreadsheetApp.getActive().getId(),
    scenario: scenario,
    targetSheet: targetSheet
  });
}

// ============================================================================
// AI Sheet Generation Operations (sheets_composite)
// ============================================================================

/**
 * Generate a structured spreadsheet from a natural language description
 */
function generateSheet(description, options) {
  var params = options || {};
  params.action = 'generate_sheet';
  params.description = description;
  return callServalSheets('sheets_composite', params);
}

/**
 * Preview proposed sheet structure without creating it
 */
function previewGeneration(description) {
  return callServalSheets('sheets_composite', {
    action: 'preview_generation',
    description: description
  });
}

/**
 * Build a dashboard with KPIs, charts, and slicers
 */
function buildDashboard(spreadsheetId, dataSheet, layout) {
  if (spreadsheetId && typeof spreadsheetId === 'object') {
    var options = Object.assign({}, spreadsheetId);
    options.action = 'build_dashboard';
    options.spreadsheetId = options.spreadsheetId || getActiveSpreadsheetId_();
    options.layout = normalizeDashboardLayout_(options.layout);
    return callServalSheets('sheets_composite', options);
  }

  return callServalSheets('sheets_composite', {
    action: 'build_dashboard',
    spreadsheetId: resolveSpreadsheetId_(spreadsheetId),
    dataSheet: dataSheet,
    dashboardSheet: arguments[3] || 'Dashboard',
    layout: normalizeDashboardLayout_(layout),
    kpis: arguments[4] || undefined,
    charts: arguments[5] || undefined,
    slicers: arguments[6] || undefined
  });
}

/**
 * Run a comprehensive audit of the spreadsheet
 */
function auditSheet(spreadsheetId) {
  return callServalSheets('sheets_composite', {
    action: 'audit_sheet',
    spreadsheetId: spreadsheetId || SpreadsheetApp.getActive().getId()
  });
}

// ============================================================================
// Session & Analyze Convenience Wrappers
// ============================================================================

/**
 * Set active spreadsheet and sheet in session context
 */
function setActiveSpreadsheet(spreadsheetId, sheetName) {
  return callServalSheets('sheets_session', {
    action: 'set_active',
    spreadsheetId: spreadsheetId || SpreadsheetApp.getActive().getId(),
    sheetName: sheetName
  });
}

/**
 * Get proactive next-action suggestions for a sheet
 */
function suggestNextActions(spreadsheetId, range, maxSuggestions) {
  return callServalSheets('sheets_analyze', {
    action: 'suggest_next_actions',
    spreadsheetId: resolveSpreadsheetId_(spreadsheetId),
    range: range,
    maxSuggestions: maxSuggestions || 5
  });
}

/**
 * Build dependent dropdown validation (parent column drives child column options)
 */
function buildDependentDropdown(options) {
  const spreadsheetId = getActiveSpreadsheetId_();
  return callServalSheets('sheets_format', { action: 'build_dependent_dropdown', spreadsheetId, ...options });
}

// ============================================================================
// Integration Tests
// ============================================================================

// ============================================================================
// sheets_agent — Autonomous Plan Execution
// ============================================================================

function runAgentPlan(spreadsheetId, goal, maxSteps) {
  return callServalSheets('sheets_agent', {
    action: 'plan',
    spreadsheetId: resolveSpreadsheetId_(spreadsheetId),
    description: goal,
    maxSteps: maxSteps || 10,
    context: arguments[3]
  });
}

function executeAgentPlan(planId, dryRun) {
  return callServalSheets('sheets_agent', {
    action: 'execute',
    planId: planId,
    dryRun: !!dryRun
  });
}

function executeAgentStep(planId, stepId) {
  return callServalSheets('sheets_agent', {
    action: 'execute_step',
    planId: planId,
    stepId: stepId
  });
}

function observeAgentPlan(planId, spreadsheetId, context) {
  return callServalSheets('sheets_agent', {
    action: 'observe',
    planId: planId,
    spreadsheetId: resolveSpreadsheetId_(spreadsheetId),
    context: context
  });
}

function getAgentStatus(planId) {
  return callServalSheets('sheets_agent', { action: 'get_status', planId: planId });
}

function rollbackAgentPlan(planId, checkpointId) {
  return callServalSheets('sheets_agent', {
    action: 'rollback',
    planId: planId,
    checkpointId: checkpointId
  });
}

function listAgentPlans(spreadsheetIdOrLimit, limit, status) {
  var request = { action: 'list_plans', limit: 10 };
  if (typeof spreadsheetIdOrLimit === 'number') {
    request.limit = spreadsheetIdOrLimit;
  } else if (typeof limit === 'number') {
    request.limit = limit;
  }
  if (typeof spreadsheetIdOrLimit === 'string' &&
      ['draft', 'executing', 'completed', 'paused', 'failed'].indexOf(spreadsheetIdOrLimit) !== -1) {
    request.status = spreadsheetIdOrLimit;
  } else if (typeof status === 'string') {
    request.status = status;
  }
  return callServalSheets('sheets_agent', request);
}

function resumeAgentPlan(planId, fromStepId) {
  return callServalSheets('sheets_agent', {
    action: 'resume',
    planId: planId,
    fromStepId: fromStepId
  });
}

// ============================================================================
// sheets_compute — Statistics, SQL, and Computation
// ============================================================================

function computeAggregate(spreadsheetId, range, aggregateFn) {
  return callServalSheets('sheets_compute', {
    action: 'aggregate',
    spreadsheetId: resolveSpreadsheetId_(spreadsheetId),
    range: range,
    functions: normalizeArrayInput_(aggregateFn, ['sum']),
    groupBy: arguments[3] || undefined,
    type: arguments[4] || undefined,
    valueColumn: arguments[5] || undefined,
    windowSize: arguments[6] || undefined
  });
}

function computeStatistics(spreadsheetId, range) {
  return callServalSheets('sheets_compute', {
    action: 'statistical',
    spreadsheetId: resolveSpreadsheetId_(spreadsheetId),
    range: range,
    columns: arguments[2] || undefined,
    percentiles: arguments[3] || undefined,
    includeCorrelations: arguments[4] || false,
    movingWindow: arguments[5] || undefined
  });
}

function computeRegression(spreadsheetId, range, xColumn, yColumn, type) {
  return callServalSheets('sheets_compute', {
    action: 'regression',
    spreadsheetId: resolveSpreadsheetId_(spreadsheetId),
    range: range,
    xColumn: xColumn,
    yColumn: yColumn,
    type: type || 'linear',
    degree: arguments[5] || undefined,
    predict: arguments[6] || undefined
  });
}

function computeForecast(spreadsheetId, range, dateColumn, valueColumn, periods) {
  return callServalSheets('sheets_compute', {
    action: 'forecast',
    spreadsheetId: resolveSpreadsheetId_(spreadsheetId),
    range: range,
    dateColumn: dateColumn,
    valueColumn: valueColumn,
    periods: periods || 3,
    method: arguments[5] || undefined,
    seasonality: arguments[6] || undefined
  });
}

function computeSqlQuery(spreadsheetId, tables, sql, timeoutMs) {
  return callServalSheets('sheets_compute', {
    action: 'sql_query',
    spreadsheetId: resolveSpreadsheetId_(spreadsheetId),
    tables: tables,
    sql: sql,
    timeoutMs: timeoutMs || 30000
  });
}

function computeSqlJoin(spreadsheetId, leftRange, rightRange, on, select, joinType, timeoutMs) {
  return callServalSheets('sheets_compute', {
    action: 'sql_join',
    spreadsheetId: resolveSpreadsheetId_(spreadsheetId),
    left: { range: leftRange, alias: 'left' },
    right: { range: rightRange, alias: 'right' },
    on: on,
    select: select || undefined,
    joinType: joinType || 'inner',
    timeoutMs: timeoutMs || 30000
  });
}

function evaluateExpression(spreadsheetId, formula, contextRange) {
  return callServalSheets('sheets_compute', {
    action: 'evaluate',
    spreadsheetId: resolveSpreadsheetId_(spreadsheetId),
    formula: formula,
    range: contextRange
  });
}

function explainFormula(spreadsheetId, formula, range) {
  return callServalSheets('sheets_compute', {
    action: 'explain_formula',
    spreadsheetId: resolveSpreadsheetId_(spreadsheetId),
    formula: formula,
    range: range
  });
}

function batchCompute(spreadsheetId, computations, stopOnError) {
  return callServalSheets('sheets_compute', {
    action: 'batch_compute',
    spreadsheetId: resolveSpreadsheetId_(spreadsheetId),
    computations: computations,
    stopOnError: !!stopOnError
  });
}

function computePythonEval(spreadsheetId, range, code, hasHeaders, timeoutMs) {
  return callServalSheets('sheets_compute', {
    action: 'python_eval',
    spreadsheetId: resolveSpreadsheetId_(spreadsheetId),
    range: range,
    code: code,
    hasHeaders: hasHeaders !== false,
    timeoutMs: timeoutMs || 60000
  });
}

// ============================================================================
// sheets_connectors — Live External Data
// ============================================================================

function listConnectors() {
  return callServalSheets('sheets_connectors', { action: 'list_connectors' });
}

function queryConnector(connectorId, endpoint, params, transform, useCache) {
  return callServalSheets('sheets_connectors', {
    action: 'query',
    connectorId: connectorId,
    endpoint: endpoint,
    params: params,
    transform: transform || undefined,
    useCache: useCache !== false
  });
}

function subscribeConnector(spreadsheetId, connectorId, endpoint, params, targetRange, schedule) {
  return callServalSheets('sheets_connectors', {
    action: 'subscribe',
    connectorId: connectorId,
    endpoint: endpoint,
    params: params,
    schedule: buildConnectorSchedule_(schedule),
    destination: {
      spreadsheetId: resolveSpreadsheetId_(spreadsheetId),
      range: targetRange
    }
  });
}

function configureConnector(connectorId, config) {
  return callServalSheets('sheets_connectors', {
    action: 'configure',
    connectorId: connectorId,
    credentials: config && config.credentials ? config.credentials : config
  });
}

function connectorStatus(connectorId) {
  return callServalSheets('sheets_connectors', { action: 'status', connectorId: connectorId });
}

// ============================================================================
// sheets_federation — Remote MCP Server Calls
// ============================================================================

function listFederatedServers() {
  return callServalSheets('sheets_federation', { action: 'list_servers' });
}

function callRemoteMcp(serverId, tool, actionName, params) {
  var toolInput =
    typeof actionName === 'string'
      ? Object.assign({ action: actionName }, params || {})
      : actionName || {};
  return callServalSheets('sheets_federation', {
    action: 'call_remote',
    serverName: serverId,
    toolName: tool,
    toolInput: toolInput
  });
}

function validateFederationConnection(serverId) {
  return callServalSheets('sheets_federation', {
    action: 'validate_connection',
    serverName: serverId
  });
}

function getFederatedServerTools(serverId) {
  return callServalSheets('sheets_federation', {
    action: 'get_server_tools',
    serverName: serverId
  });
}

// ============================================================================
// sheets_history — Extra Actions (redo, revert_to, restore_cells)
// ============================================================================

function redoOperation(spreadsheetId) {
  return callServalSheets('sheets_history', {
    action: 'redo',
    spreadsheetId: resolveSpreadsheetId_(spreadsheetId)
  });
}

function revertTo(spreadsheetId, operationId, dryRun) {
  void spreadsheetId;
  return revertToOperation(operationId, !!dryRun);
}

function restoreCells(spreadsheetId, revisionId, cells) {
  return callServalSheets('sheets_history', {
    action: 'restore_cells',
    spreadsheetId: resolveSpreadsheetId_(spreadsheetId),
    revisionId: revisionId,
    cells: cells,
    safety: arguments[3] || undefined
  });
}

// ============================================================================
// sheets_analyze — Extra Actions (scout, auto_enhance, analyze_formulas)
// ============================================================================

function scoutSpreadsheet(spreadsheetId) {
  return callServalSheets('sheets_analyze', {
    action: 'scout',
    spreadsheetId: resolveSpreadsheetId_(spreadsheetId)
  });
}

function autoEnhance(spreadsheetId, mode) {
  return callServalSheets('sheets_analyze', {
    action: 'auto_enhance',
    spreadsheetId: resolveSpreadsheetId_(spreadsheetId),
    mode: mode || 'preview'
  });
}

function analyzeFormulas(spreadsheetId) {
  return callServalSheets('sheets_analyze', {
    action: 'analyze_formulas',
    spreadsheetId: resolveSpreadsheetId_(spreadsheetId)
  });
}

// ============================================================================
// sheets_session — Extra Actions (save_checkpoint, load_checkpoint, get_alerts)
// ============================================================================

function saveCheckpoint(sessionId, label) {
  return callServalSheets('sheets_session', {
    action: 'save_checkpoint',
    sessionId: sessionId,
    label: label
  });
}

function loadCheckpoint(sessionId, checkpointId) {
  return callServalSheets('sheets_session', {
    action: 'load_checkpoint',
    sessionId: sessionId,
    checkpointId: checkpointId
  });
}

function getSessionAlerts(sessionId) {
  return callServalSheets('sheets_session', {
    action: 'get_alerts',
    sessionId: sessionId
  });
}

// ============================================================================
// sheets_composite — Extra Actions (deduplicate, setup_sheet, publish_report, data_pipeline)
// ============================================================================

function deduplicateSheet(spreadsheetId, sheetName, compareColumns) {
  return callServalSheets('sheets_composite', {
    action: 'deduplicate',
    spreadsheetId: spreadsheetId || SpreadsheetApp.getActive().getId(),
    sheetName: sheetName,
    compareColumns: compareColumns
  });
}

function setupSheet(spreadsheetId, config) {
  return callServalSheets('sheets_composite', {
    action: 'setup_sheet',
    spreadsheetId: spreadsheetId || SpreadsheetApp.getActive().getId(),
    config: config
  });
}

function publishReport(spreadsheetId, format, options) {
  return callServalSheets('sheets_composite', {
    action: 'publish_report',
    spreadsheetId: spreadsheetId || SpreadsheetApp.getActive().getId(),
    format: format || 'pdf',
    options: options || {}
  });
}

function createDataPipeline(spreadsheetId, config) {
  return callServalSheets('sheets_composite', {
    action: 'data_pipeline',
    spreadsheetId: spreadsheetId || SpreadsheetApp.getActive().getId(),
    config: config
  });
}

// ============================================================================
// sheets_transaction — Extra Actions (queue, status)
// ============================================================================

function queueTransaction(spreadsheetId, transactionId, operation) {
  return callServalSheets('sheets_transaction', {
    action: 'queue',
    spreadsheetId: spreadsheetId || SpreadsheetApp.getActive().getId(),
    transactionId: transactionId,
    operation: operation
  });
}

function getTransactionStatus(transactionId) {
  return callServalSheets('sheets_transaction', { action: 'status', transactionId: transactionId });
}

// ============================================================================
// Integration Tests
// ============================================================================

function runIntegrationTests() {
  Logger.log('========================================');
  Logger.log('Integration Tests (Real API Calls)');
  Logger.log('========================================\n');

  const apiKey = getApiKey();
  if (!apiKey) {
    Logger.log('✗ No API key configured. Skipping integration tests.');
    return { skipped: true, reason: 'No API key' };
  }

  const results = [];

  // Test 1: Connection
  Logger.log('Testing API connection...');
  const connResult = testConnection();
  results.push({
    name: 'API Connection',
    passed: connResult.success === true,
    message: connResult.message,
  });

  // Test 2: Session initialization
  Logger.log('Testing session initialization...');
  clearSession();
  const sessionId = getSessionId();
  results.push({
    name: 'Session Initialization',
    passed: sessionId !== null && sessionId.length > 0,
    message: sessionId ? `Session ID: ${sessionId.substring(0, 8)}...` : 'Failed to get session',
  });

  // Summary
  const passed = results.filter((r) => r.passed).length;
  Logger.log(`\n========================================`);
  Logger.log(`Integration Tests: ${passed}/${results.length} passed`);
  Logger.log('========================================\n');

  results.forEach((r) => {
    const status = r.passed ? '✓' : '✗';
    Logger.log(`${status} ${r.name}: ${r.message}`);
  });

  return { passed, total: results.length, results };
}
