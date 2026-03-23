# Demo Recording Guide

This guide explains how to create demo GIFs for ServalSheets documentation and README.

## Tools Required

### macOS

```bash
# Install required tools
brew install ffmpeg
brew install gifsicle
brew install --cask keycastr  # Shows keystrokes (optional)

# For terminal recording
brew install asciinema
brew install agg  # asciinema to gif converter

# Alternative: Gifox (App Store, paid but excellent)
```

### Terminal Demo (Recommended)

Using asciinema for terminal demos:

```bash
# Record terminal session
asciinema rec demo-basic.cast

# Convert to GIF
agg demo-basic.cast demo-basic.gif --theme monokai
```

## Demo Scenarios

### 1. Basic Read/Write Demo (~15 seconds)

**Script:**

```
# Show reading data
npx servalsheets read "1ABC..." "Sheet1!A1:D5"

# Show writing data
npx servalsheets write "1ABC..." "Sheet1!A1" '[["Name","Score"],["Alice",95]]'

# Show the result
npx servalsheets read "1ABC..." "Sheet1!A1:B2"
```

### 2. Safety Rails Demo (~20 seconds)

**Script:**

```
# Show dry-run mode
npx servalsheets write "1ABC..." "A1:Z100" "[[...]]" --dry-run

# Output shows what WOULD happen
# "Would update 100 rows, 26 columns (2600 cells)"

# Show with confirmation
npx servalsheets clear "1ABC..." "A:Z" --confirm

# Shows confirmation dialog
```

### 3. Claude Desktop Integration (~30 seconds)

**Script:**

1. Open Claude Desktop
2. Type: "Read my sales spreadsheet and summarize Q1 performance"
3. Show ServalSheets processing
4. Show results in Claude

### 4. AI-Powered Features (~25 seconds)

**Script:**

```
# Formula generation
npx servalsheets analyze "1ABC..." --suggest-formulas

# Chart recommendations
npx servalsheets analyze "1ABC..." --recommend-charts

# Pattern detection
npx servalsheets analyze "1ABC..." --detect-patterns
```

## Recording Settings

### Terminal Demos

- **Resolution:** 120 columns x 30 rows
- **Font Size:** 14-16pt
- **Theme:** Monokai or Dracula (dark)
- **Speed:** 1.5x playback (record at normal speed)

### Screen Recording

- **Resolution:** 1280x720 (720p) or 1920x1080 (1080p)
- **Frame Rate:** 15-30 fps for GIF
- **Duration:** 10-30 seconds per demo
- **File Size:** Target <5MB for README

## GIF Optimization

```bash
# Optimize GIF size
gifsicle -O3 --colors 256 demo.gif -o demo-optimized.gif

# Resize if needed
gifsicle --resize-width 800 demo.gif -o demo-small.gif

# Add loop and delay
gifsicle --delay=100 --loop demo.gif -o demo-loop.gif
```

## Recording Script

```bash
#!/bin/bash
# scripts/demo/record-demo.sh

DEMO_NAME=${1:-"basic"}
OUTPUT_DIR="assets/demos"

mkdir -p "$OUTPUT_DIR"

echo "Recording demo: $DEMO_NAME"
echo "Press Ctrl+D when finished"

# Record with asciinema
asciinema rec "$OUTPUT_DIR/$DEMO_NAME.cast" \
  --title "ServalSheets - $DEMO_NAME" \
  --idle-time-limit 2

# Convert to GIF
agg "$OUTPUT_DIR/$DEMO_NAME.cast" "$OUTPUT_DIR/$DEMO_NAME.gif" \
  --theme monokai \
  --font-size 14 \
  --speed 1.5

# Optimize
gifsicle -O3 --colors 256 \
  "$OUTPUT_DIR/$DEMO_NAME.gif" \
  -o "$OUTPUT_DIR/$DEMO_NAME-optimized.gif"

echo "Demo saved to: $OUTPUT_DIR/$DEMO_NAME-optimized.gif"
```

## Demo Checklist

Before recording:

- [ ] Clean terminal history
- [ ] Set up test spreadsheet with sample data
- [ ] Verify credentials are working
- [ ] Increase font size
- [ ] Hide sensitive information
- [ ] Practice the sequence

During recording:

- [ ] Type slowly and deliberately
- [ ] Pause briefly between commands
- [ ] Add comments to explain steps
- [ ] Keep demos under 30 seconds

After recording:

- [ ] Optimize file size
- [ ] Verify readability
- [ ] Test in dark and light mode
- [ ] Upload to docs/public/demos/

## Output Locations

| Demo        | File                                | Size Target |
| ----------- | ----------------------------------- | ----------- |
| Hero demo   | `docs/public/demos/hero.gif`        | <3MB        |
| Basic demo  | `docs/public/demos/basic.gif`       | <2MB        |
| Safety demo | `docs/public/demos/safety.gif`      | <2MB        |
| AI features | `docs/public/demos/ai-features.gif` | <3MB        |

## README Integration

Add to README.md:

```markdown
## Demo

![ServalSheets Demo](docs/public/demos/hero.gif)

See [more demos](./docs/demos.md) for detailed examples.
```

## Troubleshooting

### GIF too large

- Reduce colors: `--colors 128` or `--colors 64`
- Reduce resolution
- Shorten demo duration
- Increase optimization level

### Poor quality

- Increase font size during recording
- Use higher frame rate
- Avoid rapid scrolling

### Playback issues

- Ensure loop is enabled
- Check delay settings
- Verify browser compatibility
