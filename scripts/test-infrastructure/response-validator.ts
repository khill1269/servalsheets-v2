/**
 * Response Validator - Validate tool responses for correctness
 * Validates both schema compliance and functional correctness
 */

export interface ValidationResult {
  valid: boolean;
  schemaValid: boolean;
  functionalValid: boolean;
  errors: string[];
  warnings: string[];
}

export class ResponseValidator {
  /**
   * Validate a tool response
   */
  validate(tool: string, action: string, response: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Check response structure
    const hasContent = Array.isArray(response.result?.content);
    if (!hasContent) {
      errors.push('Response missing content array');
    }

    // 2. Check for text content
    const content = response.result?.content;
    let hasTextContent = false;
    let responseData: any = null;

    if (content && Array.isArray(content)) {
      for (const item of content) {
        if (item.type === 'text' && item.text) {
          hasTextContent = true;

          // Try to parse JSON response
          try {
            responseData = JSON.parse(item.text);
          } catch {
            warnings.push('Response text is not valid JSON');
          }
          break;
        }
      }
    }

    if (!hasTextContent) {
      errors.push('Response missing text content');
    }

    // 3. Validate response data structure
    if (responseData) {
      this.validateResponseData(responseData, errors, warnings);
    }

    // 4. Tool-specific validation
    this.validateToolSpecific(tool, action, responseData, errors, warnings);

    const schemaValid = errors.length === 0;
    const functionalValid = this.checkFunctionalCorrectness(tool, action, responseData);

    return {
      valid: schemaValid && functionalValid,
      schemaValid,
      functionalValid,
      errors,
      warnings,
    };
  }

  /**
   * Validate response data structure
   */
  private validateResponseData(data: any, errors: string[], warnings: string[]): void {
    // Check for response wrapper
    if (!data.response) {
      errors.push('Missing response wrapper');
      return;
    }

    const response = data.response;

    // Check for success field
    if (typeof response.success !== 'boolean') {
      warnings.push('Missing or invalid success field');
    }

    // If error, validate error structure
    if (!response.success && response.error) {
      const error = response.error;

      if (!error.code) {
        warnings.push('Error missing code field');
      }

      if (!error.message) {
        warnings.push('Error missing message field');
      }
    }

    // If success, check for action echo
    if (response.success && !response.action) {
      warnings.push('Success response missing action echo');
    }
  }

  /**
   * Tool-specific validation rules
   */
  private validateToolSpecific(
    tool: string,
    action: string,
    data: any,
    errors: string[],
    warnings: string[]
  ): void {
    const response = data?.response;
    if (!response) return;

    // sheets_data read should return data
    if (tool === 'sheets_data' && action === 'read' && response.success) {
      if (!response.values && !response.data) {
        warnings.push('Read operation missing values/data field');
      }
    }

    // sheets_data write should return updated range
    if (tool === 'sheets_data' && action === 'write' && response.success) {
      if (!response.updatedRange && !response.range) {
        warnings.push('Write operation missing updatedRange field');
      }
    }

    // sheets_core create should return spreadsheetId
    if (tool === 'sheets_core' && action === 'create' && response.success) {
      if (!response.spreadsheetId) {
        errors.push('Create operation missing spreadsheetId');
      }
    }

    // sheets_auth status should return authenticated field
    if (tool === 'sheets_auth' && action === 'status') {
      if (typeof response.authenticated !== 'boolean') {
        errors.push('Auth status missing authenticated field');
      }
    }

    // sheets_auth login should return authUrl or success message
    if (tool === 'sheets_auth' && action === 'login') {
      if (response.success && !response.authUrl && !response.message) {
        warnings.push('Login operation missing authUrl or message');
      }
    }
  }

  /**
   * Check functional correctness (does it actually work?)
   */
  private checkFunctionalCorrectness(tool: string, action: string, data: any): boolean {
    const response = data?.response;
    if (!response) return false;

    // If response indicates auth required, that's functionally correct
    if (response.error?.code === 'NOT_AUTHENTICATED' || response.error?.code === 'AUTH_REQUIRED') {
      return true;
    }

    // If response indicates success, check for expected data
    if (response.success) {
      // Most operations should have some data on success
      const hasData =
        response.data ||
        response.values ||
        response.spreadsheetId ||
        response.sheetId ||
        response.range ||
        response.message ||
        Object.keys(response).length > 2; // More than just success and action

      return hasData;
    }

    // If response is an error, it should have proper error structure
    if (!response.success) {
      return Boolean(response.error?.code && response.error?.message);
    }

    return false;
  }

  /**
   * Validate MCP protocol compliance
   */
  validateMCPProtocol(response: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check JSON-RPC structure
    if (!response.jsonrpc) {
      errors.push('Missing jsonrpc field');
    } else if (response.jsonrpc !== '2.0') {
      warnings.push(`Unexpected JSON-RPC version: ${response.jsonrpc}`);
    }

    // Check for id field
    if (typeof response.id !== 'number') {
      errors.push('Missing or invalid id field');
    }

    // Must have either result or error
    if (!response.result && !response.error) {
      errors.push('Response must have either result or error field');
    }

    // Should not have both result and error
    if (response.result && response.error) {
      errors.push('Response should not have both result and error fields');
    }

    return {
      valid: errors.length === 0,
      schemaValid: errors.length === 0,
      functionalValid: true,
      errors,
      warnings,
    };
  }
}
