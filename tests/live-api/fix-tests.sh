#!/bin/bash

# Script to fix live API tests to reduce quota consumption
# Changes beforeEach spreadsheet creation to beforeAll

cd "/Users/thomascahill/Documents/servalsheets 2/tests/live-api/tools"

# Files that need fixing (still have createTestSpreadsheet in beforeEach)
FILES=(
  "sheets-advanced.live.test.ts"
  "sheets-analyze.live.test.ts"
  "sheets-appsscript.live.test.ts"
  "sheets-bigquery.live.test.ts"
  "sheets-collaborate.live.test.ts"
  "sheets-composite.live.test.ts"
  "sheets-confirm.live.test.ts"
  "sheets-dependencies.live.test.ts"
  "sheets-fix.live.test.ts"
  "sheets-history.live.test.ts"
  "sheets-quality.live.test.ts"
  "sheets-session.live.test.ts"
  "sheets-templates.live.test.ts"
  "sheets-transaction.live.test.ts"
  "sheets-webhook.live.test.ts"
)

for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "Processing $file..."
    
    # Check if file has beforeEach with createTestSpreadsheet
    if grep -q "beforeEach.*async.*{" "$file" && grep -q "createTestSpreadsheet" "$file"; then
      echo "  - Found beforeEach with createTestSpreadsheet"
      
      # Create backup
      cp "$file" "$file.bak"
      
      # Use node to process the file with more complex logic
      node -e "
const fs = require('fs');
const content = fs.readFileSync('$file', 'utf8');

// Find the beforeEach that contains createTestSpreadsheet
const beforeEachRegex = /beforeEach\(async \(\) => \{[\s\S]*?createTestSpreadsheet[\s\S]*?\n  \}\);/;
const match = content.match(beforeEachRegex);

if (match) {
  // Extract the body
  const body = match[0];
  
  // Check if there's already a beforeAll with createTestSpreadsheet
  if (content.includes('beforeAll') && content.includes('createTestSpreadsheet')) {
    console.log('  - Already has beforeAll with createTestSpreadsheet, skipping');
    process.exit(0);
  }
  
  // Find the existing beforeAll block
  const beforeAllRegex = /(beforeAll\(async \(\) => \{[\s\S]*?manager = new TestSpreadsheetManager\(client\);)/;
  const beforeAllMatch = content.match(beforeAllRegex);
  
  if (beforeAllMatch) {
    // Extract content from beforeEach to add to beforeAll
    const spreadsheetCreation = body.match(/testSpreadsheet = await manager\.createTestSpreadsheet\([^)]+\);/);
    const metaFetch = body.match(/const meta = await client\.sheets\.spreadsheets\.get\(\{[\s\S]*?\}\);/);
    const sheetIdAssign = body.match(/sheetId = meta\.data\.sheets!\[0\]\.properties!\.sheetId!;/);
    
    let newBeforeAll = beforeAllMatch[1];
    
    // Add spreadsheet creation
    if (spreadsheetCreation) {
      newBeforeAll += '\\n    \\n    // Create ONE spreadsheet for all tests\\n    ' + spreadsheetCreation[0];
    }
    
    // Add meta fetch if present
    if (metaFetch) {
      newBeforeAll += '\\n    ' + metaFetch[0];
    }
    
    // Add sheetId assignment if present
    if (sheetIdAssign) {
      newBeforeAll += '\\n    ' + sheetIdAssign[0];
    }
    
    // Replace the beforeAll
    let newContent = content.replace(beforeAllRegex, newBeforeAll);
    
    // Update beforeAll timeout
    newContent = newContent.replace(/beforeAll\(async \(\) => \{[\s\S]*?\}, \d+\);/, (m) => m.replace(/\}, \d+\);$/, '}, 60000);'));
    
    // Check if beforeAll doesn't have timeout, add it
    if (!newContent.match(/beforeAll\(async \(\) => \{[\s\S]*?\}, \d+\);/)) {
      newContent = newContent.replace(/(beforeAll\(async \(\) => \{[\s\S]*?\n  \}\))(\);)/, '\$1, 60000\$2');
    }
    
    // Replace beforeEach with data clearing version if it had spreadsheet creation
    const newBeforeEach = \`beforeEach(async () => {
    // Clear test data instead of creating new spreadsheet
    try {
      await client.sheets.spreadsheets.values.clear({
        spreadsheetId: testSpreadsheet.id,
        range: 'TestData!A:ZZ',
      });
    } catch { /* ignore if sheet doesn't exist */ }
  });\`;
    
    newContent = newContent.replace(beforeEachRegex, newBeforeEach);
    
    fs.writeFileSync('$file', newContent);
    console.log('  - Updated successfully');
  } else {
    console.log('  - Could not find beforeAll block');
  }
} else {
  console.log('  - No matching beforeEach found');
}
"
    else
      echo "  - No beforeEach with createTestSpreadsheet found"
    fi
  else
    echo "File not found: $file"
  fi
done

echo "Done!"
