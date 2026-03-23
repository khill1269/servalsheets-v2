# Vale Prose Linting Setup

Vale is a prose linter for technical documentation that checks grammar, style, tone, and readability.

## Installation

### macOS

```bash
brew install vale
```

### Linux

```bash
# Download latest release from https://github.com/errata-ai/vale/releases
wget https://github.com/errata-ai/vale/releases/download/v3.0.7/vale_3.0.7_Linux_64-bit.tar.gz
tar -xvzf vale_3.0.7_Linux_64-bit.tar.gz
sudo mv vale /usr/local/bin/
```

### Windows

```powershell
choco install vale
# or use scoop:
scoop install vale
```

## Setup Style Packages

After installing Vale, download the style packages:

```bash
# From project root
vale sync
```

This will download:

- **Vale** - Core style rules
- **write-good** - Checks for common writing issues
- **proselint** - Grammar and style checks

## Usage

### Check a single file

```bash
vale docs/guides/QUICKSTART.md
```

### Check all documentation

```bash
vale docs/**/*.md --ignore-syntax
```

### Check with npm script

```bash
npm run docs:prose        # Check prose quality
npm run docs:prose:fix    # Show suggestions for fixes
```

## Configuration

The [../.vale.ini](../.vale.ini) file configures Vale for technical documentation:

- **Allows technical jargon** (API, CLI, JSON, etc.)
- **Lenient on passive voice** (common in tech docs)
- **Checks for clarity** (wordiness, hedging language)
- **Validates tone** (consistency, readability)

## Ignoring False Positives

To ignore specific rules in a document, use HTML comments:

```markdown
<!-- vale off -->

This text won't be checked by Vale.

<!-- vale on -->

<!-- vale Vale.Spelling = NO -->

This paragraph allows custom spellings like ServalSheets.

<!-- vale Vale.Spelling = YES -->
```

## VS Code Integration

Install the [Vale VS Code extension](https://marketplace.visualstudio.com/items?itemName=errata-ai.vale-server) for real-time prose linting:

```bash
code --install-extension errata-ai.vale-server
```

Add to `.vscode/settings.json`:

```json
{
  "vale.valeCLI.config": "${workspaceFolder}/.vale.ini"
}
```

## CI Integration

Vale is included in the documentation validation workflow ([../.github/workflows/docs-validation.yml](../.github/workflows/docs-validation.yml)).

Prose quality checks run on every PR that modifies documentation files.

## Custom Rules

To add custom style rules:

1. Create a new style package in `.vale/styles/MyStyle/`
2. Add `.yml` rule files following [Vale's rule syntax](https://vale.sh/docs/topics/styles/)
3. Update `.vale.ini` to include your style:

   ```ini
   BasedOnStyles = Vale, write-good, proselint, MyStyle
   ```

## Resources

- [Vale Documentation](https://vale.sh/docs/)
- [Available Style Guides](https://vale.sh/hub/)
- [Rule Syntax](https://vale.sh/docs/topics/styles/)
- [VS Code Extension](https://marketplace.visualstudio.com/items?itemName=errata-ai.vale-server)
