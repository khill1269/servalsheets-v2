/**
 * ServalSheets - Sheet Templates
 *
 * Reusable data templates for common test scenarios.
 * Provides consistent test data across all live API tests.
 */

/**
 * Template metadata
 */
export interface SheetTemplate {
  /** Template identifier */
  name: string;
  /** Human-readable description */
  description: string;
  /** Column headers */
  headers: string[];
  /** Data rows (2D array) */
  data: unknown[][];
  /** Total rows including header */
  rowCount: number;
  /** Total columns */
  columnCount: number;
  /** Whether template includes formulas */
  hasFormulas: boolean;
  /** Whether template includes special characters */
  hasUnicode: boolean;
}

/**
 * Basic template - Simple headers with 10 rows of data
 */
export const TEMPLATE_BASIC: SheetTemplate = {
  name: 'BASIC',
  description: 'Simple data with headers and 10 rows',
  headers: ['ID', 'Name', 'Value', 'Category', 'Active'],
  data: [
    [1, 'Item 1', 100, 'A', true],
    [2, 'Item 2', 200, 'B', false],
    [3, 'Item 3', 300, 'A', true],
    [4, 'Item 4', 400, 'C', true],
    [5, 'Item 5', 500, 'B', false],
    [6, 'Item 6', 600, 'A', true],
    [7, 'Item 7', 700, 'C', false],
    [8, 'Item 8', 800, 'B', true],
    [9, 'Item 9', 900, 'A', false],
    [10, 'Item 10', 1000, 'C', true],
  ],
  rowCount: 11,
  columnCount: 5,
  hasFormulas: false,
  hasUnicode: false,
};

/**
 * Template with formulas including cross-references
 */
export const TEMPLATE_FORMULAS: SheetTemplate = {
  name: 'FORMULAS',
  description: 'Data with formulas and cross-references',
  headers: ['Value', 'Double', 'Sum', 'Cumulative', 'Running Avg'],
  data: [
    [100, '=A2*2', '=A2+B2', '=A2', '=A2'],
    [200, '=A3*2', '=A3+B3', '=D2+A3', '=D3/2'],
    [300, '=A4*2', '=A4+B4', '=D3+A4', '=D4/3'],
    [400, '=A5*2', '=A5+B5', '=D4+A5', '=D5/4'],
    [500, '=A6*2', '=A6+B6', '=D5+A6', '=D6/5'],
    ['=SUM(A2:A6)', '=SUM(B2:B6)', '=SUM(C2:C6)', '=D6', '=AVERAGE(A2:A6)'],
  ],
  rowCount: 7,
  columnCount: 5,
  hasFormulas: true,
  hasUnicode: false,
};

/**
 * Large template - 1000 rows with 26 columns (A-Z)
 */
export function generateLargeTemplate(
  rowCount: number = 1000,
  columnCount: number = 26
): SheetTemplate {
  const headers = Array.from(
    { length: columnCount },
    (_, i) => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26).toString() : '')
  );

  const data: unknown[][] = [];
  for (let row = 0; row < rowCount; row++) {
    const rowData: unknown[] = [];
    for (let col = 0; col < columnCount; col++) {
      // Mix of data types
      switch (col % 5) {
        case 0:
          rowData.push(row + 1);
          break; // Number (ID)
        case 1:
          rowData.push(`Row ${row + 1} Col ${col + 1}`);
          break; // String
        case 2:
          rowData.push(Math.random() * 1000);
          break; // Float
        case 3:
          rowData.push(row % 2 === 0);
          break; // Boolean
        case 4:
          rowData.push(new Date(2024, 0, row + 1).toISOString().split('T')[0]);
          break; // Date
      }
    }
    data.push(rowData);
  }

  return {
    name: 'LARGE',
    description: `Large dataset with ${rowCount} rows and ${columnCount} columns`,
    headers,
    data,
    rowCount: rowCount + 1,
    columnCount,
    hasFormulas: false,
    hasUnicode: false,
  };
}

/**
 * Unicode template - 30+ languages, emoji, RTL
 */
export const TEMPLATE_UNICODE: SheetTemplate = {
  name: 'UNICODE',
  description: 'International text with 30+ languages, emoji, and RTL',
  headers: ['Language', 'Greeting', 'Sample Text', 'Numbers', 'Special'],
  data: [
    // European Languages
    ['English', 'Hello', 'The quick brown fox jumps over the lazy dog', '123,456.78', '© ® ™'],
    ['Spanish', 'Hola', 'El veloz murciélago hindú comía feliz cardillo', '123.456,78', '¿¡áéíóúñ'],
    [
      'French',
      'Bonjour',
      'Portez ce vieux whisky au juge blond qui fume',
      '123 456,78',
      'àâæçéèêë',
    ],
    [
      'German',
      'Guten Tag',
      'Falsches Üben von Xylophonmusik quält jeden größeren Zwerg',
      '123.456,78',
      'äöüß',
    ],
    ['Portuguese', 'Olá', 'Vejam a bruxa da raposa verde', '123.456,78', 'ãõç'],
    ['Italian', 'Ciao', 'Quel fsjfhzqui vituperabile xenofobo', '123.456,78', 'àèéìòù'],
    ['Polish', 'Cześć', 'Pchnąć w tę łódź jeża lub ośm skrzyń fig', '123 456,78', 'ąćęłńóśźż'],
    ['Russian', 'Привет', 'Съешь ещё этих мягких французских булок', '123 456,78', 'йцукенгшщ'],
    ['Ukrainian', 'Привіт', 'Чуєш їх, доки ґава спить на фасаді', '123 456,78', 'ґєіїйь'],
    ['Greek', 'Γειά σου', 'Ξεσκεπάζω την ψυχοφθόρα βδελυγμία', '123.456,78', 'αβγδεζ'],

    // Asian Languages
    ['Chinese (Simplified)', '你好', '天地玄黄宇宙洪荒', '123,456.78', '简体中文'],
    ['Chinese (Traditional)', '你好', '天地玄黃宇宙洪荒', '123,456.78', '繁體中文'],
    ['Japanese', 'こんにちは', 'いろはにほへとちりぬるを', '123,456.78', 'ひらがなカタカナ'],
    ['Korean', '안녕하세요', '키스의 고유조건은 입술끼리 만나야', '123,456.78', '한글테스트'],
    ['Thai', 'สวัสดี', 'เป็นมนุษย์สุดประเสริฐเลิศคุณค่า', '123,456.78', 'ภาษาไทย'],
    ['Vietnamese', 'Xin chào', 'Tôi có thể ăn thủy tinh mà không hại gì', '123.456,78', 'ắằẳẵặ'],
    ['Hindi', 'नमस्ते', 'एक मुख्य बड़े शहरों की पेशकश', '१,२३,४५६.७८', 'हिन्दी'],
    ['Tamil', 'வணக்கம்', 'திருக்குறள் தமிழ்நாட்டின்', '1,23,456.78', 'தமிழ்'],
    ['Bengali', 'নমস্কার', 'আমার সোনার বাংলা আমি তোমায়', '১,২৩,৪৫৬.৭৮', 'বাংলা'],

    // RTL Languages
    ['Arabic', 'مرحبا', 'صِف خَلقَ خَودٍ كَمِثلِ الشَمسِ إِذ بَزَغَت', '١٢٣٬٤٥٦٫٧٨', 'العربية'],
    ['Hebrew', 'שלום', 'דג סקרן שט בים מאוכזב ולפתע מצא חברה', '123,456.78', 'עברית'],
    ['Persian', 'سلام', 'طول و عرض جهان بدیهی مشخص است', '۱۲۳٬۴۵۶٫۷۸', 'فارسی'],
    ['Urdu', 'سلام', 'میں کانچ کھا سکتا ہوں، اس سے مجھے کوئی نقصان', '۱۲٬۳۴٬۵۶۷', 'اردو'],

    // Emoji and Special
    ['Emoji Basic', '👋', '🎉🎊🎁🎈🎂', '1️⃣2️⃣3️⃣', '💯✅❌⚠️'],
    ['Emoji Sequences', '👨‍👩‍👧‍👦', '🏳️‍🌈🏴‍☠️', '👩‍💻👨‍🔬', '🧑‍🤝‍🧑'],
    ['Emoji Skin Tones', '👋🏻', '👋🏼👋🏽👋🏾👋🏿', '🤝🏻🤝🏿', '👨🏻‍💻👩🏿‍🔬'],
    ['Symbols', '∑∏∫∂∇', '∞≠≤≥±×÷', '→←↑↓↔', '★☆●○◆◇'],
    ['Currency', '$€£¥₹', '¢₽₩₿₪', '฿₺₴₸₼', '₡₲₵₭₮'],
    ['Math', 'α β γ δ ε', 'π σ τ φ ψ', '√∛∜∝∞', '∀∃∄∅∈'],

    // Edge Cases
    ['Zero Width', 'A\u200BB\u200CC', '\u200D\uFEFF', '\u00AD\u034F', 'invisible'],
    ['Combining Chars', 'é', 'e\u0301', 'ñ n\u0303', 'a\u0308\u0301'],
    ['Long Text', 'Test', 'A'.repeat(1000), 'B'.repeat(500), 'C'.repeat(100)],
  ],
  rowCount: 33,
  columnCount: 5,
  hasFormulas: false,
  hasUnicode: true,
};

/**
 * Edge cases template - Boundary conditions
 */
export const TEMPLATE_EDGE_CASES: SheetTemplate = {
  name: 'EDGE_CASES',
  description: 'Boundary conditions and edge cases',
  headers: ['Type', 'Value', 'Description', 'Expected', 'Notes'],
  data: [
    // Numeric edge cases
    ['Number', 0, 'Zero', 0, 'Falsy but valid'],
    ['Number', -0, 'Negative zero', 0, 'IEEE 754'],
    ['Number', Number.MAX_SAFE_INTEGER, 'Max safe integer', '9007199254740991', 'JS limit'],
    ['Number', Number.MIN_SAFE_INTEGER, 'Min safe integer', '-9007199254740991', 'JS limit'],
    ['Number', 0.1 + 0.2, 'Float precision', '0.30000000000000004', 'Floating point'],
    ['Number', 1e308, 'Very large', '1e+308', 'Near max'],
    ['Number', 1e-308, 'Very small', '1e-308', 'Near min'],

    // String edge cases
    ['String', '', 'Empty string', '', 'Falsy'],
    ['String', ' ', 'Single space', ' ', 'Whitespace'],
    ['String', '\t\n\r', 'Control chars', 'Tab, LF, CR', 'Whitespace'],
    ['String', "'quotes'", 'Single quotes', "'quotes'", 'Escape test'],
    ['String', '"double"', 'Double quotes', '"double"', 'Escape test'],
    ['String', 'back\\slash', 'Backslash', 'back\\slash', 'Escape test'],
    ['String', 'line\nbreak', 'Newline', 'Multi-line', 'In cell'],
    ['String', 'tab\there', 'Tab', 'Tabbed', 'In cell'],

    // Boolean edge cases
    ['Boolean', true, 'True', 'TRUE', 'Sheets format'],
    ['Boolean', false, 'False', 'FALSE', 'Sheets format'],
    ['Boolean', 'true', 'String true', 'true', 'Not boolean'],
    ['Boolean', 'false', 'String false', 'false', 'Not boolean'],
    ['Boolean', 1, 'Number one', '1', 'Truthy'],
    ['Boolean', 0, 'Number zero', '0', 'Falsy'],

    // Special values
    ['Special', null, 'Null', '', 'Empty cell'],
    ['Special', undefined, 'Undefined', '', 'Empty cell'],
    ['Special', 'NULL', 'String NULL', 'NULL', 'Not null'],
    ['Special', '#N/A', 'Error value', '#N/A', 'Error type'],
    ['Special', '#REF!', 'Ref error', '#REF!', 'Error type'],
    ['Special', '#DIV/0!', 'Div by zero', '#DIV/0!', 'Error type'],

    // Formula edge cases (as strings to not evaluate)
    ['Formula', '=1+1', 'Simple formula', '2', 'Will evaluate'],
    ['Formula', "'=1+1", 'Escaped formula', '=1+1', 'Text prefix'],
    ['Formula', '=A1', 'Self reference', '#REF!', 'Circular'],
    ['Formula', '=INDIRECT("A1")', 'Indirect ref', 'Dynamic', 'Volatile'],
  ],
  rowCount: 31,
  columnCount: 5,
  hasFormulas: false,
  hasUnicode: false,
};

/**
 * Date and time template
 */
export const TEMPLATE_DATES: SheetTemplate = {
  name: 'DATES',
  description: 'Date and time formats',
  headers: ['Format', 'Value', 'Display', 'Timezone', 'Notes'],
  data: [
    ['ISO 8601', '2024-01-15', '2024-01-15', 'UTC', 'Standard format'],
    ['ISO DateTime', '2024-01-15T10:30:00Z', '2024-01-15 10:30:00', 'UTC', 'With time'],
    ['ISO With TZ', '2024-01-15T10:30:00-05:00', '2024-01-15 15:30:00', 'EST', 'Offset'],
    ['US Format', '01/15/2024', 'January 15, 2024', 'Local', 'MM/DD/YYYY'],
    ['EU Format', '15/01/2024', '15 January 2024', 'Local', 'DD/MM/YYYY'],
    ['Unix Timestamp', '1705315800', '2024-01-15 10:30:00', 'UTC', 'Seconds'],
    ['Unix MS', '1705315800000', '2024-01-15 10:30:00', 'UTC', 'Milliseconds'],
    ['Sheets Serial', '45306', '2024-01-15', 'N/A', 'Days since 1899'],
    ['Time Only', '10:30:00', '10:30 AM', 'Local', 'No date'],
    ['Duration', '1:30:00', '1 hour 30 min', 'N/A', 'Duration'],
    ['Leap Year', '2024-02-29', 'February 29, 2024', 'N/A', '2024 is leap year'],
    ['Year Start', '2024-01-01', 'January 1, 2024', 'N/A', 'First day'],
    ['Year End', '2024-12-31', 'December 31, 2024', 'N/A', 'Last day'],
    ['Epoch', '1970-01-01', 'January 1, 1970', 'UTC', 'Unix epoch'],
    ['Future', '2099-12-31', 'December 31, 2099', 'N/A', 'Far future'],
  ],
  rowCount: 16,
  columnCount: 5,
  hasFormulas: false,
  hasUnicode: false,
};

/**
 * Get template data as a 2D array ready for Sheets API
 * Includes header row
 */
export function getTemplateData(template: SheetTemplate): unknown[][] {
  return [template.headers, ...template.data];
}

/**
 * Get template data without headers
 */
export function getTemplateDataOnly(template: SheetTemplate): unknown[][] {
  return [...template.data];
}

/**
 * Get range string for template
 */
export function getTemplateRange(template: SheetTemplate, sheetName: string = 'Sheet1'): string {
  const endCol = String.fromCharCode(64 + template.columnCount);
  return `${sheetName}!A1:${endCol}${template.rowCount}`;
}

/**
 * Get a subset of template data
 */
export function getTemplateSubset(
  template: SheetTemplate,
  startRow: number,
  endRow: number,
  includeHeaders: boolean = false
): unknown[][] {
  const data = includeHeaders
    ? [template.headers, ...template.data.slice(startRow, endRow)]
    : template.data.slice(startRow, endRow);
  return data;
}

/**
 * All available templates
 */
export const TEMPLATES = {
  BASIC: TEMPLATE_BASIC,
  FORMULAS: TEMPLATE_FORMULAS,
  UNICODE: TEMPLATE_UNICODE,
  EDGE_CASES: TEMPLATE_EDGE_CASES,
  DATES: TEMPLATE_DATES,
  LARGE: generateLargeTemplate(1000, 26),
} as const;

export type TemplateName = keyof typeof TEMPLATES;

/**
 * Get template by name
 */
export function getTemplate(name: TemplateName): SheetTemplate {
  return TEMPLATES[name];
}

/**
 * Generate custom template
 */
export function generateCustomTemplate(
  name: string,
  headers: string[],
  rowGenerator: (rowIndex: number) => unknown[],
  rowCount: number
): SheetTemplate {
  const data: unknown[][] = [];
  for (let i = 0; i < rowCount; i++) {
    data.push(rowGenerator(i));
  }

  return {
    name,
    description: `Custom template with ${rowCount} rows`,
    headers,
    data,
    rowCount: rowCount + 1,
    columnCount: headers.length,
    hasFormulas: false,
    hasUnicode: false,
  };
}
