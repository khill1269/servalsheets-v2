/**
 * GraphQL Schema Definition
 *
 * Provides a GraphQL API layer over the MCP tool system.
 * Allows querying spreadsheet data and executing operations via GraphQL.
 */

export const typeDefs = `#graphql
  # Scalar types
  scalar JSON

  # Core types
  type Tool {
    name: String!
    description: String!
    inputSchema: JSON!
    actions: [String!]!
    actionCount: Int!
  }

  type Spreadsheet {
    spreadsheetId: String!
    title: String
    sheets: [Sheet!]
    properties: JSON
  }

  type Sheet {
    sheetId: Int!
    title: String!
    index: Int!
    gridProperties: GridProperties
  }

  type GridProperties {
    rowCount: Int!
    columnCount: Int!
    frozenRowCount: Int
    frozenColumnCount: Int
  }

  type CellValue {
    row: Int!
    col: Int!
    value: String
    formattedValue: String
    formula: String
  }

  type RangeData {
    range: String!
    values: [[String]]!
    rowCount: Int!
    columnCount: Int!
  }

  # Operation results
  type OperationResult {
    success: Boolean!
    message: String
    data: JSON
    spreadsheetId: String
    updatedCells: Int
    error: ErrorInfo
  }

  type ErrorInfo {
    code: String!
    message: String!
    details: JSON
  }

  # System status
  type ServerInfo {
    version: String!
    protocolVersion: String!
    toolCount: Int!
    actionCount: Int!
    uptime: Float!
    status: String!
  }

  type CircuitBreakerStatus {
    name: String!
    state: String!
    failureCount: Int!
    successCount: Int!
    lastFailureTime: Float
  }

  # Queries
  type Query {
    # System queries
    serverInfo: ServerInfo!
    tools: [Tool!]!
    tool(name: String!): Tool
    circuitBreakers: [CircuitBreakerStatus!]!

    # Spreadsheet queries
    spreadsheet(spreadsheetId: String!): Spreadsheet
    spreadsheetMetadata(spreadsheetId: String!): JSON
    readRange(spreadsheetId: String!, range: String!): RangeData
    getCell(spreadsheetId: String!, row: Int!, col: Int!, sheetName: String): CellValue

    # Search and discovery
    searchSpreadsheets(query: String!): [Spreadsheet!]!
    listSheets(spreadsheetId: String!): [Sheet!]!
  }

  # Mutations
  type Mutation {
    # Write operations
    writeRange(
      spreadsheetId: String!
      range: String!
      values: [[String!]!]!
    ): OperationResult!

    updateCell(
      spreadsheetId: String!
      row: Int!
      col: Int!
      value: String!
      sheetName: String
    ): OperationResult!

    # Sheet operations
    createSheet(
      spreadsheetId: String!
      title: String!
      rowCount: Int
      columnCount: Int
    ): OperationResult!

    deleteSheet(
      spreadsheetId: String!
      sheetId: Int!
    ): OperationResult!

    # Batch operations
    batchUpdate(
      spreadsheetId: String!
      requests: [JSON!]!
    ): OperationResult!

    # Formatting
    applyFormat(
      spreadsheetId: String!
      range: String!
      format: JSON!
    ): OperationResult!
  }

  # Subscriptions (for real-time updates)
  type Subscription {
    spreadsheetUpdated(spreadsheetId: String!): OperationResult!
    toolExecuted: OperationResult!
  }
`;
