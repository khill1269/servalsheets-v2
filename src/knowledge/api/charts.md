# Google Sheets Chart Types Complete Reference

> **API Version:** Google Sheets API v4  
> **Last Updated:** January 4, 2026  
> **Purpose:** Complete chart configuration guide for ServalSheets

---

## Table of Contents

1. [Chart Fundamentals](#chart-fundamentals)
2. [Basic Charts](#basic-charts)
3. [Advanced Charts](#advanced-charts)
4. [Chart Components](#chart-components)
5. [Styling & Formatting](#styling--formatting)
6. [Common Patterns](#common-patterns)
7. [Complete Examples](#complete-examples)

---

## Chart Fundamentals

### Chart Structure

```typescript
interface EmbeddedChart {
  chartId?: number; // Auto-generated on create
  position: EmbeddedObjectPosition;
  spec: ChartSpec;
  border?: EmbeddedObjectBorder;
}

interface ChartSpec {
  title?: string;
  altText?: string;
  titleTextFormat?: TextFormat;
  titleTextPosition?: TextPosition;
  subtitle?: string;
  subtitleTextFormat?: TextFormat;
  subtitleTextPosition?: TextPosition;
  fontName?: string;
  backgroundColor?: Color;
  maximized?: boolean;
  hiddenDimensionStrategy?:
    | 'CHART_HIDDEN_DIMENSION_STRATEGY_UNSPECIFIED'
    | 'SKIP_HIDDEN_ROWS_AND_COLUMNS'
    | 'SKIP_HIDDEN_ROWS'
    | 'SKIP_HIDDEN_COLUMNS'
    | 'SHOW_ALL';
  // One of the following chart types:
  basicChart?: BasicChartSpec;
  pieChart?: PieChartSpec;
  bubbleChart?: BubbleChartSpec;
  candlestickChart?: CandlestickChartSpec;
  orgChart?: OrgChartSpec;
  histogramChart?: HistogramChartSpec;
  waterfallChart?: WaterfallChartSpec;
  treemapChart?: TreemapChartSpec;
  scorecardChart?: ScorecardChartSpec;
}
```

### Chart Position

```typescript
interface EmbeddedObjectPosition {
  // Option 1: Overlay on cells
  overlayPosition?: OverlayPosition;
  // Option 2: New sheet
  newSheet?: boolean;
  // Option 3: Specific sheet
  sheetId?: number;
}

interface OverlayPosition {
  anchorCell: GridCoordinate;
  offsetXPixels?: number;
  offsetYPixels?: number;
  widthPixels?: number;
  heightPixels?: number;
}

// Example: Position chart at cell E1
const position: EmbeddedObjectPosition = {
  overlayPosition: {
    anchorCell: {
      sheetId: 0,
      rowIndex: 0,
      columnIndex: 4, // Column E
    },
    widthPixels: 600,
    heightPixels: 400,
  },
};
```

---

## Basic Charts

### BasicChartSpec Structure

```typescript
interface BasicChartSpec {
  chartType: BasicChartType;
  legendPosition?: LegendPosition;
  axis?: BasicChartAxis[];
  domains?: BasicChartDomain[];
  series?: BasicChartSeries[];
  headerCount?: number;
  threeDimensional?: boolean;
  interpolateNulls?: boolean;
  stackedType?: 'NOT_STACKED' | 'STACKED' | 'PERCENT_STACKED';
  lineSmoothing?: boolean;
  compareMode?: 'BASIC_CHART_COMPARE_MODE_UNSPECIFIED' | 'DATUM' | 'CATEGORY';
  totalDataLabel?: DataLabel;
}

type BasicChartType = 'BAR' | 'LINE' | 'AREA' | 'COLUMN' | 'SCATTER' | 'COMBO' | 'STEPPED_AREA';

type LegendPosition = 'BOTTOM_LEGEND' | 'LEFT_LEGEND' | 'RIGHT_LEGEND' | 'TOP_LEGEND' | 'NO_LEGEND';
```

### BAR Chart

Horizontal bars comparing categories.

```typescript
const barChart: ChartSpec = {
  title: 'Sales by Region',
  basicChart: {
    chartType: 'BAR',
    legendPosition: 'RIGHT_LEGEND',
    axis: [
      {
        position: 'BOTTOM_AXIS',
        title: 'Sales ($)',
        format: { pattern: '$#,##0' },
      },
      {
        position: 'LEFT_AXIS',
        title: 'Region',
      },
    ],
    domains: [
      {
        domain: {
          sourceRange: {
            sources: [
              {
                sheetId: 0,
                startRowIndex: 0,
                endRowIndex: 6,
                startColumnIndex: 0,
                endColumnIndex: 1,
              },
            ],
          },
        },
      },
    ],
    series: [
      {
        series: {
          sourceRange: {
            sources: [
              {
                sheetId: 0,
                startRowIndex: 0,
                endRowIndex: 6,
                startColumnIndex: 1,
                endColumnIndex: 2,
              },
            ],
          },
        },
        targetAxis: 'BOTTOM_AXIS',
        color: { red: 0.2, green: 0.6, blue: 0.9 },
        dataLabel: {
          type: 'DATA',
          placement: 'INSIDE_END',
          textFormat: { bold: true },
        },
      },
    ],
    headerCount: 1,
  },
};
```

### COLUMN Chart

Vertical bars for category comparison.

```typescript
const columnChart: ChartSpec = {
  title: 'Monthly Revenue',
  basicChart: {
    chartType: 'COLUMN',
    legendPosition: 'BOTTOM_LEGEND',
    axis: [
      {
        position: 'BOTTOM_AXIS',
        title: 'Month',
      },
      {
        position: 'LEFT_AXIS',
        title: 'Revenue ($)',
        format: { pattern: '$#,##0K' },
      },
    ],
    domains: [
      {
        domain: {
          sourceRange: {
            sources: [
              {
                sheetId: 0,
                startRowIndex: 0,
                endRowIndex: 13,
                startColumnIndex: 0,
                endColumnIndex: 1,
              },
            ],
          },
        },
      },
    ],
    series: [
      {
        series: {
          sourceRange: {
            sources: [
              {
                sheetId: 0,
                startRowIndex: 0,
                endRowIndex: 13,
                startColumnIndex: 1,
                endColumnIndex: 2,
              },
            ],
          },
        },
        targetAxis: 'LEFT_AXIS',
        color: { red: 0.2, green: 0.7, blue: 0.3 },
      },
      {
        series: {
          sourceRange: {
            sources: [
              {
                sheetId: 0,
                startRowIndex: 0,
                endRowIndex: 13,
                startColumnIndex: 2,
                endColumnIndex: 3,
              },
            ],
          },
        },
        targetAxis: 'LEFT_AXIS',
        color: { red: 0.9, green: 0.5, blue: 0.1 },
      },
    ],
    headerCount: 1,
    stackedType: 'NOT_STACKED', // or 'STACKED', 'PERCENT_STACKED'
  },
};
```

### LINE Chart

```typescript
const lineChart: ChartSpec = {
  title: 'Stock Price Over Time',
  basicChart: {
    chartType: 'LINE',
    legendPosition: 'BOTTOM_LEGEND',
    lineSmoothing: true,
    interpolateNulls: true,
    axis: [
      {
        position: 'BOTTOM_AXIS',
        title: 'Date',
      },
      {
        position: 'LEFT_AXIS',
        title: 'Price ($)',
        format: { pattern: '$#,##0.00' },
      },
    ],
    domains: [
      {
        domain: {
          sourceRange: {
            sources: [
              {
                sheetId: 0,
                startRowIndex: 0,
                endRowIndex: 31,
                startColumnIndex: 0,
                endColumnIndex: 1,
              },
            ],
          },
        },
      },
    ],
    series: [
      {
        series: {
          sourceRange: {
            sources: [
              {
                sheetId: 0,
                startRowIndex: 0,
                endRowIndex: 31,
                startColumnIndex: 1,
                endColumnIndex: 2,
              },
            ],
          },
        },
        targetAxis: 'LEFT_AXIS',
        color: { red: 0.0, green: 0.4, blue: 0.8 },
        lineStyle: { type: 'SOLID', width: 2 },
        pointStyle: { shape: 'CIRCLE', size: 6 },
      },
    ],
    headerCount: 1,
  },
};
```

### AREA Chart

```typescript
const areaChart: ChartSpec = {
  title: 'Website Traffic',
  basicChart: {
    chartType: 'AREA',
    legendPosition: 'BOTTOM_LEGEND',
    stackedType: 'STACKED',
    lineSmoothing: true,
    axis: [
      { position: 'BOTTOM_AXIS', title: 'Week' },
      { position: 'LEFT_AXIS', title: 'Visitors' },
    ],
    domains: [
      {
        domain: {
          sourceRange: {
            sources: [
              {
                sheetId: 0,
                startRowIndex: 0,
                endRowIndex: 12,
                startColumnIndex: 0,
                endColumnIndex: 1,
              },
            ],
          },
        },
      },
    ],
    series: [
      {
        series: {
          sourceRange: {
            sources: [
              {
                sheetId: 0,
                startRowIndex: 0,
                endRowIndex: 12,
                startColumnIndex: 1,
                endColumnIndex: 2,
              },
            ],
          },
        },
        color: { red: 0.2, green: 0.5, blue: 0.9, alpha: 0.7 },
      },
      {
        series: {
          sourceRange: {
            sources: [
              {
                sheetId: 0,
                startRowIndex: 0,
                endRowIndex: 12,
                startColumnIndex: 2,
                endColumnIndex: 3,
              },
            ],
          },
        },
        color: { red: 0.9, green: 0.3, blue: 0.3, alpha: 0.7 },
      },
    ],
    headerCount: 1,
  },
};
```

### SCATTER Chart

```typescript
const scatterChart: ChartSpec = {
  title: 'Height vs Weight',
  basicChart: {
    chartType: 'SCATTER',
    legendPosition: 'RIGHT_LEGEND',
    axis: [
      {
        position: 'BOTTOM_AXIS',
        title: 'Height (cm)',
        viewWindowOptions: { viewWindowMin: 150, viewWindowMax: 200 },
      },
      {
        position: 'LEFT_AXIS',
        title: 'Weight (kg)',
        viewWindowOptions: { viewWindowMin: 40, viewWindowMax: 100 },
      },
    ],
    domains: [
      {
        domain: {
          sourceRange: {
            sources: [
              {
                sheetId: 0,
                startRowIndex: 0,
                endRowIndex: 50,
                startColumnIndex: 0,
                endColumnIndex: 1,
              },
            ],
          },
        },
      },
    ],
    series: [
      {
        series: {
          sourceRange: {
            sources: [
              {
                sheetId: 0,
                startRowIndex: 0,
                endRowIndex: 50,
                startColumnIndex: 1,
                endColumnIndex: 2,
              },
            ],
          },
        },
        pointStyle: {
          shape: 'CIRCLE',
          size: 8,
        },
        color: { red: 0.8, green: 0.2, blue: 0.2 },
      },
    ],
    headerCount: 1,
  },
};
```

### COMBO Chart

Mix line and column in same chart.

```typescript
const comboChart: ChartSpec = {
  title: 'Sales & Growth Rate',
  basicChart: {
    chartType: 'COMBO',
    legendPosition: 'BOTTOM_LEGEND',
    axis: [
      { position: 'BOTTOM_AXIS', title: 'Quarter' },
      { position: 'LEFT_AXIS', title: 'Sales ($)' },
      { position: 'RIGHT_AXIS', title: 'Growth (%)' },
    ],
    domains: [
      {
        domain: {
          sourceRange: {
            sources: [
              {
                sheetId: 0,
                startRowIndex: 0,
                endRowIndex: 5,
                startColumnIndex: 0,
                endColumnIndex: 1,
              },
            ],
          },
        },
      },
    ],
    series: [
      {
        // Column series for sales
        series: {
          sourceRange: {
            sources: [
              {
                sheetId: 0,
                startRowIndex: 0,
                endRowIndex: 5,
                startColumnIndex: 1,
                endColumnIndex: 2,
              },
            ],
          },
        },
        targetAxis: 'LEFT_AXIS',
        type: 'COLUMN',
        color: { red: 0.2, green: 0.6, blue: 0.9 },
      },
      {
        // Line series for growth rate
        series: {
          sourceRange: {
            sources: [
              {
                sheetId: 0,
                startRowIndex: 0,
                endRowIndex: 5,
                startColumnIndex: 2,
                endColumnIndex: 3,
              },
            ],
          },
        },
        targetAxis: 'RIGHT_AXIS',
        type: 'LINE',
        color: { red: 0.9, green: 0.4, blue: 0.1 },
        lineStyle: { type: 'SOLID', width: 3 },
        pointStyle: { shape: 'DIAMOND', size: 8 },
      },
    ],
    headerCount: 1,
  },
};
```

---

## Advanced Charts

### PIE Chart

```typescript
interface PieChartSpec {
  legendPosition?: LegendPosition;
  domain?: ChartData;
  series?: ChartData;
  threeDimensional?: boolean;
  pieHole?: number; // 0-1, makes donut chart
}

const pieChart: ChartSpec = {
  title: 'Market Share',
  pieChart: {
    legendPosition: 'RIGHT_LEGEND',
    domain: {
      sourceRange: {
        sources: [
          {
            sheetId: 0,
            startRowIndex: 0,
            endRowIndex: 5,
            startColumnIndex: 0,
            endColumnIndex: 1,
          },
        ],
      },
    },
    series: {
      sourceRange: {
        sources: [
          {
            sheetId: 0,
            startRowIndex: 0,
            endRowIndex: 5,
            startColumnIndex: 1,
            endColumnIndex: 2,
          },
        ],
      },
    },
    threeDimensional: false,
    pieHole: 0, // 0 = pie, 0.5 = donut
  },
};

// Donut chart variant
const donutChart: ChartSpec = {
  title: 'Budget Distribution',
  pieChart: {
    legendPosition: 'BOTTOM_LEGEND',
    domain: {
      /* ... */
    },
    series: {
      /* ... */
    },
    pieHole: 0.5, // Creates hole in center
  },
};
```

### BUBBLE Chart

```typescript
interface BubbleChartSpec {
  legendPosition?: LegendPosition;
  bubbleLabels?: ChartData;
  domain?: ChartData;
  series?: ChartData;
  groupIds?: ChartData;
  bubbleSizes?: ChartData;
  bubbleOpacity?: number; // 0-1
  bubbleBorderColor?: Color;
  bubbleMaxRadiusSize?: number;
  bubbleMinRadiusSize?: number;
  bubbleTextStyle?: TextFormat;
}

const bubbleChart: ChartSpec = {
  title: 'Country Comparison',
  bubbleChart: {
    legendPosition: 'RIGHT_LEGEND',
    bubbleOpacity: 0.7,
    bubbleMinRadiusSize: 5,
    bubbleMaxRadiusSize: 50,
    // X-axis: GDP
    domain: {
      sourceRange: {
        sources: [
          {
            sheetId: 0,
            startRowIndex: 1,
            endRowIndex: 20,
            startColumnIndex: 1,
            endColumnIndex: 2,
          },
        ],
      },
    },
    // Y-axis: Life Expectancy
    series: {
      sourceRange: {
        sources: [
          {
            sheetId: 0,
            startRowIndex: 1,
            endRowIndex: 20,
            startColumnIndex: 2,
            endColumnIndex: 3,
          },
        ],
      },
    },
    // Bubble size: Population
    bubbleSizes: {
      sourceRange: {
        sources: [
          {
            sheetId: 0,
            startRowIndex: 1,
            endRowIndex: 20,
            startColumnIndex: 3,
            endColumnIndex: 4,
          },
        ],
      },
    },
    // Labels: Country names
    bubbleLabels: {
      sourceRange: {
        sources: [
          {
            sheetId: 0,
            startRowIndex: 1,
            endRowIndex: 20,
            startColumnIndex: 0,
            endColumnIndex: 1,
          },
        ],
      },
    },
  },
};
```

### CANDLESTICK Chart

```typescript
interface CandlestickChartSpec {
  domain?: CandlestickDomain;
  data?: CandlestickData[];
}

interface CandlestickData {
  lowSeries?: CandlestickSeries;
  openSeries?: CandlestickSeries;
  closeSeries?: CandlestickSeries;
  highSeries?: CandlestickSeries;
}

const candlestickChart: ChartSpec = {
  title: 'Stock OHLC',
  candlestickChart: {
    domain: {
      data: {
        sourceRange: {
          sources: [
            {
              sheetId: 0,
              startRowIndex: 1,
              endRowIndex: 31,
              startColumnIndex: 0, // Date column
              endColumnIndex: 1,
            },
          ],
        },
      },
    },
    data: [
      {
        lowSeries: {
          data: {
            sourceRange: {
              sources: [
                {
                  sheetId: 0,
                  startRowIndex: 1,
                  endRowIndex: 31,
                  startColumnIndex: 3, // Low column
                  endColumnIndex: 4,
                },
              ],
            },
          },
        },
        openSeries: {
          data: {
            sourceRange: {
              sources: [
                {
                  sheetId: 0,
                  startRowIndex: 1,
                  endRowIndex: 31,
                  startColumnIndex: 1, // Open column
                  endColumnIndex: 2,
                },
              ],
            },
          },
        },
        closeSeries: {
          data: {
            sourceRange: {
              sources: [
                {
                  sheetId: 0,
                  startRowIndex: 1,
                  endRowIndex: 31,
                  startColumnIndex: 4, // Close column
                  endColumnIndex: 5,
                },
              ],
            },
          },
        },
        highSeries: {
          data: {
            sourceRange: {
              sources: [
                {
                  sheetId: 0,
                  startRowIndex: 1,
                  endRowIndex: 31,
                  startColumnIndex: 2, // High column
                  endColumnIndex: 3,
                },
              ],
            },
          },
        },
      },
    ],
  },
};
```

### HISTOGRAM Chart

```typescript
interface HistogramChartSpec {
  legendPosition?: LegendPosition;
  series?: HistogramSeries[];
  showItemDividers?: boolean;
  bucketSize?: number;
  outlierPercentile?: number;
}

const histogramChart: ChartSpec = {
  title: 'Score Distribution',
  histogramChart: {
    legendPosition: 'BOTTOM_LEGEND',
    bucketSize: 10,
    showItemDividers: true,
    outlierPercentile: 0.05,
    series: [
      {
        barColor: { red: 0.2, green: 0.6, blue: 0.9 },
        data: {
          sourceRange: {
            sources: [
              {
                sheetId: 0,
                startRowIndex: 1,
                endRowIndex: 100,
                startColumnIndex: 0,
                endColumnIndex: 1,
              },
            ],
          },
        },
      },
    ],
  },
};
```

### WATERFALL Chart

```typescript
interface WaterfallChartSpec {
  domain?: WaterfallChartDomain;
  series?: WaterfallChartSeries[];
  stackedType?: 'STACKED' | 'SEQUENTIAL';
  firstValueIsTotal?: boolean;
  hideConnectorLines?: boolean;
  connectorLineStyle?: LineStyle;
  totalDataLabel?: DataLabel;
}

const waterfallChart: ChartSpec = {
  title: 'Profit Analysis',
  waterfallChart: {
    stackedType: 'SEQUENTIAL',
    firstValueIsTotal: false,
    hideConnectorLines: false,
    domain: {
      data: {
        sourceRange: {
          sources: [
            {
              sheetId: 0,
              startRowIndex: 0,
              endRowIndex: 8,
              startColumnIndex: 0,
              endColumnIndex: 1,
            },
          ],
        },
      },
    },
    series: [
      {
        data: {
          sourceRange: {
            sources: [
              {
                sheetId: 0,
                startRowIndex: 0,
                endRowIndex: 8,
                startColumnIndex: 1,
                endColumnIndex: 2,
              },
            ],
          },
        },
        positiveColumnsStyle: {
          color: { red: 0.2, green: 0.7, blue: 0.3 },
        },
        negativeColumnsStyle: {
          color: { red: 0.9, green: 0.2, blue: 0.2 },
        },
        subtotalColumnsStyle: {
          color: { red: 0.5, green: 0.5, blue: 0.5 },
        },
      },
    ],
  },
};
```

### TREEMAP Chart

```typescript
interface TreemapChartSpec {
  labels?: ChartData;
  parentLabels?: ChartData;
  sizeData?: ChartData;
  colorData?: ChartData;
  textFormat?: TextFormat;
  levels?: number;
  hintedLevels?: number;
  minValue?: number;
  maxValue?: number;
  headerColor?: Color;
  colorScale?: TreemapChartColorScale;
  hideTooltips?: boolean;
}

const treemapChart: ChartSpec = {
  title: 'Disk Usage',
  treemapChart: {
    levels: 2,
    labels: {
      sourceRange: {
        sources: [
          {
            sheetId: 0,
            startRowIndex: 1,
            endRowIndex: 20,
            startColumnIndex: 0,
            endColumnIndex: 1,
          },
        ],
      },
    },
    parentLabels: {
      sourceRange: {
        sources: [
          {
            sheetId: 0,
            startRowIndex: 1,
            endRowIndex: 20,
            startColumnIndex: 1,
            endColumnIndex: 2,
          },
        ],
      },
    },
    sizeData: {
      sourceRange: {
        sources: [
          {
            sheetId: 0,
            startRowIndex: 1,
            endRowIndex: 20,
            startColumnIndex: 2,
            endColumnIndex: 3,
          },
        ],
      },
    },
    colorScale: {
      minValueColor: { red: 0.9, green: 0.9, blue: 0.9 },
      midValueColor: { red: 0.5, green: 0.7, blue: 0.9 },
      maxValueColor: { red: 0.1, green: 0.3, blue: 0.7 },
    },
  },
};
```

### SCORECARD Chart

```typescript
interface ScorecardChartSpec {
  keyValueData?: ChartData;
  baselineValueData?: ChartData;
  aggregateType?: 'AVERAGE' | 'COUNT' | 'MAX' | 'MEDIAN' | 'MIN' | 'SUM';
  keyValueFormat?: KeyValueFormat;
  baselineValueFormat?: BaselineValueFormat;
  scaleFactor?: number;
  numberFormatSource?: 'FROM_DATA' | 'CUSTOM';
  customFormatOptions?: ChartCustomNumberFormatOptions;
}

const scorecardChart: ChartSpec = {
  title: 'KPI Dashboard',
  scorecardChart: {
    keyValueData: {
      sourceRange: {
        sources: [
          {
            sheetId: 0,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 1,
            endColumnIndex: 2,
          },
        ],
      },
    },
    baselineValueData: {
      sourceRange: {
        sources: [
          {
            sheetId: 0,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 2,
            endColumnIndex: 3,
          },
        ],
      },
    },
    aggregateType: 'SUM',
    keyValueFormat: {
      textFormat: {
        fontSize: 48,
        bold: true,
        foregroundColor: { red: 0.2, green: 0.6, blue: 0.3 },
      },
      position: { horizontalAlignment: 'CENTER' },
    },
    baselineValueFormat: {
      comparisonType: 'PERCENTAGE_DIFFERENCE',
      textFormat: { fontSize: 24 },
      positiveColor: { red: 0.2, green: 0.7, blue: 0.3 },
      negativeColor: { red: 0.9, green: 0.2, blue: 0.2 },
    },
  },
};
```

### ORG Chart

```typescript
interface OrgChartSpec {
  nodeSize?: 'ORG_CHART_LABEL_SIZE_UNSPECIFIED' | 'SMALL' | 'MEDIUM' | 'LARGE';
  nodeColor?: Color;
  selectedNodeColor?: Color;
  labels?: ChartData;
  parentLabels?: ChartData;
  tooltips?: ChartData;
  nodeColorStyle?: ColorStyle;
  selectedNodeColorStyle?: ColorStyle;
}

const orgChart: ChartSpec = {
  title: 'Company Structure',
  orgChart: {
    nodeSize: 'MEDIUM',
    nodeColor: { red: 0.9, green: 0.95, blue: 1.0 },
    selectedNodeColor: { red: 0.8, green: 0.9, blue: 1.0 },
    labels: {
      sourceRange: {
        sources: [
          {
            sheetId: 0,
            startRowIndex: 1,
            endRowIndex: 10,
            startColumnIndex: 0,
            endColumnIndex: 1,
          },
        ],
      },
    },
    parentLabels: {
      sourceRange: {
        sources: [
          {
            sheetId: 0,
            startRowIndex: 1,
            endRowIndex: 10,
            startColumnIndex: 1,
            endColumnIndex: 2,
          },
        ],
      },
    },
    tooltips: {
      sourceRange: {
        sources: [
          {
            sheetId: 0,
            startRowIndex: 1,
            endRowIndex: 10,
            startColumnIndex: 2,
            endColumnIndex: 3,
          },
        ],
      },
    },
  },
};
```

---

## Chart Components

### Axis Configuration

```typescript
interface BasicChartAxis {
  position: 'BOTTOM_AXIS' | 'LEFT_AXIS' | 'RIGHT_AXIS';
  title?: string;
  titleTextPosition?: TextPosition;
  format?: TextFormat;
  viewWindowOptions?: ChartAxisViewWindowOptions;
}

interface ChartAxisViewWindowOptions {
  viewWindowMin?: number;
  viewWindowMax?: number;
  viewWindowMode?:
    | 'DEFAULT_VIEW_WINDOW_MODE'
    | 'VIEW_WINDOW_MODE_UNSUPPORTED'
    | 'EXPLICIT'
    | 'PRETTY';
}

// Example: Custom axis range
const customAxis: BasicChartAxis = {
  position: 'LEFT_AXIS',
  title: 'Revenue ($M)',
  format: {
    pattern: '$#,##0.0,,', // Millions format
  },
  viewWindowOptions: {
    viewWindowMode: 'EXPLICIT',
    viewWindowMin: 0,
    viewWindowMax: 100,
  },
};
```

### Data Labels

```typescript
interface DataLabel {
  type: 'NONE' | 'DATA' | 'CUSTOM';
  textFormat?: TextFormat;
  placement?:
    | 'CENTER'
    | 'LEFT'
    | 'RIGHT'
    | 'ABOVE'
    | 'BELOW'
    | 'INSIDE_END'
    | 'INSIDE_BASE'
    | 'OUTSIDE_END';
  customLabelData?: ChartData;
}

// Example: Show values on bars
const dataLabel: DataLabel = {
  type: 'DATA',
  placement: 'OUTSIDE_END',
  textFormat: {
    fontSize: 10,
    bold: true,
    foregroundColor: { red: 0.2, green: 0.2, blue: 0.2 },
  },
};
```

### Line & Point Styles

```typescript
interface LineStyle {
  width?: number;
  type?:
    | 'INVISIBLE'
    | 'SOLID'
    | 'DOTTED'
    | 'MEDIUM_DASHED'
    | 'MEDIUM_DASHED_DOTTED'
    | 'LONG_DASHED'
    | 'LONG_DASHED_DOTTED';
}

interface PointStyle {
  size?: number;
  shape?: 'POINT_SHAPE_UNSPECIFIED' | 'CIRCLE' | 'SQUARE' | 'DIAMOND' | 'TRIANGLE' | 'X' | 'STAR';
}

// Example: Dashed line with diamond points
const series: BasicChartSeries = {
  series: {
    /* data source */
  },
  lineStyle: {
    width: 2,
    type: 'MEDIUM_DASHED',
  },
  pointStyle: {
    size: 8,
    shape: 'DIAMOND',
  },
  color: { red: 0.8, green: 0.2, blue: 0.4 },
};
```

---

## Styling & Formatting

### Color Palette (0-1 Scale)

```typescript
const CHART_COLORS = {
  // Blues
  blue1: { red: 0.26, green: 0.52, blue: 0.96 },
  blue2: { red: 0.42, green: 0.65, blue: 0.87 },

  // Greens
  green1: { red: 0.26, green: 0.7, blue: 0.46 },
  green2: { red: 0.52, green: 0.78, blue: 0.35 },

  // Reds
  red1: { red: 0.92, green: 0.26, blue: 0.21 },
  red2: { red: 0.85, green: 0.41, blue: 0.35 },

  // Oranges
  orange1: { red: 0.96, green: 0.49, blue: 0.13 },
  orange2: { red: 0.96, green: 0.65, blue: 0.26 },

  // Purples
  purple1: { red: 0.63, green: 0.28, blue: 0.64 },
  purple2: { red: 0.74, green: 0.48, blue: 0.76 },

  // Grays
  gray1: { red: 0.38, green: 0.38, blue: 0.38 },
  gray2: { red: 0.62, green: 0.62, blue: 0.62 },
};
```

### Text Formatting

```typescript
interface TextFormat {
  foregroundColor?: Color;
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
}

const titleFormat: TextFormat = {
  fontFamily: 'Roboto',
  fontSize: 18,
  bold: true,
  foregroundColor: { red: 0.2, green: 0.2, blue: 0.2 },
};
```

---

## Common Patterns

### Create Chart Request

```typescript
const addChartRequest = {
  addChart: {
    chart: {
      spec: {
        title: 'Sales Report',
        basicChart: {
          chartType: 'COLUMN',
          // ... chart configuration
        },
      },
      position: {
        overlayPosition: {
          anchorCell: { sheetId: 0, rowIndex: 0, columnIndex: 5 },
          widthPixels: 600,
          heightPixels: 400,
        },
      },
    },
  },
};
```

### Update Chart Request

```typescript
const updateChartRequest = {
  updateChartSpec: {
    chartId: 123456789,
    spec: {
      title: 'Updated Title',
      basicChart: {
        chartType: 'LINE', // Change chart type
        // ... updated configuration
      },
    },
  },
};
```

### Move Chart Request

```typescript
const moveChartRequest = {
  updateEmbeddedObjectPosition: {
    objectId: 123456789,
    newPosition: {
      overlayPosition: {
        anchorCell: { sheetId: 0, rowIndex: 10, columnIndex: 0 },
        widthPixels: 800,
        heightPixels: 500,
      },
    },
    fields: 'overlayPosition',
  },
};
```

### Delete Chart Request

```typescript
const deleteChartRequest = {
  deleteEmbeddedObject: {
    objectId: 123456789,
  },
};
```

---

## Complete Examples

### Sales Dashboard with Multiple Charts

```typescript
const dashboardRequests = [
  // 1. Revenue Column Chart
  {
    addChart: {
      chart: {
        spec: {
          title: 'Monthly Revenue',
          basicChart: {
            chartType: 'COLUMN',
            legendPosition: 'BOTTOM_LEGEND',
            axis: [
              { position: 'BOTTOM_AXIS', title: 'Month' },
              { position: 'LEFT_AXIS', title: 'Revenue ($K)' },
            ],
            domains: [
              {
                domain: {
                  sourceRange: {
                    sources: [
                      {
                        sheetId: 0,
                        startRowIndex: 0,
                        endRowIndex: 13,
                        startColumnIndex: 0,
                        endColumnIndex: 1,
                      },
                    ],
                  },
                },
              },
            ],
            series: [
              {
                series: {
                  sourceRange: {
                    sources: [
                      {
                        sheetId: 0,
                        startRowIndex: 0,
                        endRowIndex: 13,
                        startColumnIndex: 1,
                        endColumnIndex: 2,
                      },
                    ],
                  },
                },
                color: { red: 0.2, green: 0.6, blue: 0.9 },
              },
            ],
            headerCount: 1,
          },
        },
        position: {
          overlayPosition: {
            anchorCell: { sheetId: 0, rowIndex: 0, columnIndex: 4 },
            widthPixels: 500,
            heightPixels: 300,
          },
        },
      },
    },
  },
  // 2. Market Share Pie Chart
  {
    addChart: {
      chart: {
        spec: {
          title: 'Market Share',
          pieChart: {
            legendPosition: 'RIGHT_LEGEND',
            pieHole: 0.4,
            domain: {
              sourceRange: {
                sources: [
                  {
                    sheetId: 1,
                    startRowIndex: 0,
                    endRowIndex: 6,
                    startColumnIndex: 0,
                    endColumnIndex: 1,
                  },
                ],
              },
            },
            series: {
              sourceRange: {
                sources: [
                  {
                    sheetId: 1,
                    startRowIndex: 0,
                    endRowIndex: 6,
                    startColumnIndex: 1,
                    endColumnIndex: 2,
                  },
                ],
              },
            },
          },
        },
        position: {
          overlayPosition: {
            anchorCell: { sheetId: 0, rowIndex: 0, columnIndex: 10 },
            widthPixels: 400,
            heightPixels: 300,
          },
        },
      },
    },
  },
  // 3. Trend Line Chart
  {
    addChart: {
      chart: {
        spec: {
          title: 'Growth Trend',
          basicChart: {
            chartType: 'LINE',
            lineSmoothing: true,
            legendPosition: 'BOTTOM_LEGEND',
            axis: [
              { position: 'BOTTOM_AXIS', title: 'Quarter' },
              { position: 'LEFT_AXIS', title: 'Growth (%)' },
            ],
            domains: [
              {
                domain: {
                  sourceRange: {
                    sources: [
                      {
                        sheetId: 2,
                        startRowIndex: 0,
                        endRowIndex: 9,
                        startColumnIndex: 0,
                        endColumnIndex: 1,
                      },
                    ],
                  },
                },
              },
            ],
            series: [
              {
                series: {
                  sourceRange: {
                    sources: [
                      {
                        sheetId: 2,
                        startRowIndex: 0,
                        endRowIndex: 9,
                        startColumnIndex: 1,
                        endColumnIndex: 2,
                      },
                    ],
                  },
                },
                color: { red: 0.2, green: 0.7, blue: 0.3 },
                lineStyle: { width: 3, type: 'SOLID' },
                pointStyle: { size: 6, shape: 'CIRCLE' },
              },
            ],
            headerCount: 1,
          },
        },
        position: {
          overlayPosition: {
            anchorCell: { sheetId: 0, rowIndex: 16, columnIndex: 4 },
            widthPixels: 600,
            heightPixels: 300,
          },
        },
      },
    },
  },
];

// Execute batch update
await sheets.spreadsheets.batchUpdate({
  spreadsheetId: 'your-spreadsheet-id',
  requestBody: { requests: dashboardRequests },
});
```

---

_Source: Google Sheets API v4 Documentation_
