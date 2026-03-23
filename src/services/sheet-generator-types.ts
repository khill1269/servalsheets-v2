import type { GeneratedSheetDefinition } from '../schemas/composite.js';

export interface SheetDefinition {
  title: string;
  sheets: GeneratedSheetDefinition[];
}

export interface GenerateOptions {
  context?: string;
  style?: 'minimal' | 'professional' | 'dashboard';
  spreadsheetId?: string;
  sheetName?: string;
}
