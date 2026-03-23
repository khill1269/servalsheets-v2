/**
 * =SERVAL() — AI-powered custom function for Google Sheets
 *
 * Usage:
 *   =SERVAL("sum revenue by month where status is Closed")
 *   =SERVAL("lookup product name", A2:B10)
 *   =SERVAL("forecast next 3 months", C2:C13)
 *
 * Requires: ServalSheets HTTP server running with ANTHROPIC_API_KEY configured
 *
 * @param {string} prompt Natural language description of the formula you need
 * @param {Range} [ranges] Optional cell ranges for context
 * @return {string} The generated Google Sheets formula
 * @customfunction
 */
function SERVAL(prompt, ...ranges) {
  if (!prompt) {
    throw new Error('SERVAL requires a prompt. Example: =SERVAL("sum column B where A is 2026")');
  }

  var serverUrl = PropertiesService.getScriptProperties().getProperty('SERVAL_SERVER_URL');
  if (!serverUrl) {
    throw new Error(
      'SERVAL_SERVER_URL not configured. Run setupServal() or set in Script Properties.'
    );
  }

  // Build request payload
  var payload = {
    prompt: prompt,
    spreadsheetId: SpreadsheetApp.getActiveSpreadsheet().getId(),
  };

  // Extract headers and sample data from provided ranges
  if (ranges.length > 0) {
    var firstRange = ranges[0];
    if (Array.isArray(firstRange) && firstRange.length > 0) {
      payload.headers = firstRange[0].map(String);
      payload.sampleData = firstRange.slice(0, 5);
    }
  }

  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  // Add API key if configured
  var apiKey = PropertiesService.getScriptProperties().getProperty('SERVAL_API_KEY');
  if (apiKey) {
    options.headers = { Authorization: 'Bearer ' + apiKey };
  }

  var response = UrlFetchApp.fetch(serverUrl + '/api/formula-eval', options);
  var code = response.getResponseCode();

  if (code !== 200) {
    var errorBody = JSON.parse(response.getContentText());
    throw new Error('SERVAL error: ' + (errorBody.error?.message || 'Unknown error'));
  }

  var result = JSON.parse(response.getContentText());
  return result.formula || '#ERROR: No formula generated';
}

/**
 * One-time setup: configure the ServalSheets server URL.
 * Run this from the Apps Script editor (Run > setupServal).
 */
function setupServal() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt(
    'ServalSheets Setup',
    'Enter your ServalSheets server URL (e.g., https://serval.example.com):',
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() === ui.Button.OK) {
    var url = response.getResponseText().trim().replace(/\/+$/, '');
    PropertiesService.getScriptProperties().setProperty('SERVAL_SERVER_URL', url);
    ui.alert('ServalSheets configured! You can now use =SERVAL() in cells.');
  }
}
