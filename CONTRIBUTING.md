# Contributing to ServalSheets

Thank you for your interest in contributing to ServalSheets! This guide will help you get started with development, testing, and submitting changes.

---

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [Getting Started](#getting-started)
3. [Development Setup](#development-setup)
4. [Making Changes](#making-changes)
5. [Testing Guidelines](#testing-guidelines)
6. [Code Style](#code-style)
7. [Documentation](#documentation)
8. [Submitting Changes](#submitting-changes)
9. [Release Process](#release-process)

---

## Code of Conduct

By participating in this project, you agree to:

- Be respectful and inclusive
- Provide constructive feedback
- Focus on what is best for the community
- Show empathy towards other community members

---

## Getting Started

### Prerequisites

- **Node.js:** 20.x or later
- **npm:** 10.x or later
- **Git:** Latest version
- **Google Cloud Account:** For testing OAuth flows (optional)

### Clone the Repository

```bash
git clone https://github.com/khill1269/servalsheets.git
cd servalsheets
npm install
```

---

## Development Setup

### 1. Google Cloud Setup (Optional)

For testing OAuth flows and API integration:

1. Create a Google Cloud project
2. Enable Google Sheets API and Drive API
3. Create OAuth 2.0 credentials
4. Configure redirect URIs

See [README.md Authentication](README.md#authentication) for detailed instructions.

### 2. Environment Configuration

```bash
cp .env.example .env
# Edit .env with your credentials
```

Required environment variables for OAuth testing:

- `GOOGLE_CLIENT_ID` - OAuth client ID
- `GOOGLE_CLIENT_SECRET` - OAuth client secret
- `GOOGLE_REDIRECT_URI` - OAuth redirect URI (e.g., http://localhost:3000/oauth/callback)
- `ENCRYPTION_KEY` - 256-bit encryption key (generate: `openssl rand -hex 32`)

### 3. Build the Project

```bash
npm run build
```

### 4. Run Tests

```bash
npm test
```

**Expected results:**

- 2,150+ passing tests
- Duration: ~10 seconds
- Coverage: 53%+ (target: 75%)

---

## Making Changes

### Branch Naming

Use descriptive branch names following these patterns:

- `feat/add-pivot-tables` - New features
- `fix/batch-timeout` - Bug fixes
- `docs/contributing-guide` - Documentation
- `refactor/cache-manager` - Code refactoring
- `test/coverage-increase` - Test additions
- `chore/update-deps` - Maintenance tasks

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:**

- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation changes
- `refactor` - Code refactoring (no functional changes)
- `test` - Test additions/fixes
- `chore` - Build/tooling changes
- `perf` - Performance improvements

**Examples:**

```
feat(handlers): add pivot table support

Implements sheets_visualize_table tool with operations:
- create_pivot_table
- update_pivot_table
- delete_pivot_table

Includes comprehensive tests and documentation.

Closes #123
```

```
fix(batching): prevent timeout on large batch operations

Batch compiler was not respecting 100-request limit from
Google Sheets API, causing timeouts on large operations.

Now splits batches at 100 requests and processes sequentially.

Fixes #456
```

---

## Testing Guidelines

### Test Requirements

All changes must include tests:

- **New features:** Unit + integration tests
- **Bug fixes:** Regression test demonstrating the fix
- **Refactoring:** All existing tests must pass

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test handlers/values.test.ts

# Run with coverage
npm run test:coverage

# Run integration tests (requires credentials)
TEST_SPREADSHEET_ID=your-id npm test

# Run in watch mode during development
npm test -- --watch
```

### Writing Tests

Use descriptive test names with the Arrange-Act-Assert (AAA) pattern:

```typescript
describe('ValuesHandler', () => {
  describe('get_values action', () => {
    it('should return cell values for valid range', async () => {
      // Arrange
      const params = {
        action: 'get_values' as const,
        spreadsheetId: 'test-id',
        range: 'Sheet1!A1:B10',
      };

      // Act
      const result = await handler.handle(params);

      // Assert
      expect(result.values).toHaveLength(10);
      expect(result.values[0]).toHaveLength(2);
    });

    it('should throw ValidationError for invalid range', async () => {
      // Arrange
      const params = {
        action: 'get_values' as const,
        spreadsheetId: 'test-id',
        range: 'InvalidRange!!!',
      };

      // Act & Assert
      await expect(handler.handle(params)).rejects.toThrow(ValidationError);
    });
  });
});
```

### Test Coverage Requirements

- **Minimum coverage:** 60% (current floor, enforced in CI)
- **Target coverage:** 75%
- **Critical paths:** 90%+

Coverage is enforced in CI:

```bash
npm run test:coverage -- --coverage.thresholds.lines=60
```

**Focus areas for increasing coverage:**

1. Error paths (quota exceeded, network failures, invalid inputs)
2. Edge cases (empty ranges, maximum cell counts, special characters)
3. Property-based tests with fast-check

---

## Code Style

### TypeScript Guidelines

1. **Use strict mode** (already configured in tsconfig.json)
2. **Explicit return types** for all public functions
3. **No `any` types** - use `unknown` with type guards
4. **Prefer readonly** for immutable data
5. **Use type imports** - `import type { ... }`

**Example:**

```typescript
// ✅ Good
export async function getSpreadsheet(spreadsheetId: string): Promise<Spreadsheet> {
  // Implementation
}

// ❌ Bad
export async function getSpreadsheet(spreadsheetId) {
  // Missing parameter type
  // Missing return type
}
```

### Linting

Run ESLint before committing:

```bash
# Check for errors
npm run lint

# Auto-fix issues
npm run lint:fix
```

**Zero tolerance policy:**

- All ESLint errors must be fixed
- Warnings should be addressed or justified
- Use `// eslint-disable-next-line` sparingly with comments

### Formatting

Use Prettier for code formatting (runs automatically on save in most IDEs):

```bash
npm run format
```

---

## Documentation

### TSDoc Requirements

All public APIs must include TSDoc comments:

````typescript
/**
 * Fetches cell values from a Google Sheets spreadsheet.
 *
 * @param spreadsheetId - The spreadsheet ID
 * @param range - A1 notation range (e.g., "Sheet1!A1:B10")
 * @returns Promise resolving to cell values as 2D array
 * @throws {ValidationError} If range format is invalid
 * @throws {NotFoundError} If spreadsheet not found
 * @throws {QuotaExceededError} If Google API quota exceeded
 *
 * @example
 * ```typescript
 * const values = await getValues("1BxiMVs0...", "Sheet1!A1:B10");
 * console.log(values); // [["Name", "Age"], ["Alice", "30"], ...]
 * ```
 *
 * @see {@link https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets.values}
 */
export async function getValues(spreadsheetId: string, range: string): Promise<string[][]> {
  // Implementation
}
````

**Required TSDoc tags:**

- `@param` - Parameter descriptions
- `@returns` - Return value description
- `@throws` - Possible error types
- `@example` - Usage examples
- `@see` - Related documentation links

### Documentation Files

Update relevant documentation when making changes:

- **README.md** - For user-facing changes
- **CHANGELOG.md** - For all changes (following Keep a Changelog format)
- **SECURITY.md** - For security-related changes
- **docs/\*.md** - For detailed guides and architecture docs

---

## Submitting Changes

### Pull Request Process

1. **Fork the repository** (external contributors)
2. **Create a feature branch** from `main`
3. **Make your changes** with tests
4. **Run full test suite**: `npm test`
5. **Run linter**: `npm run lint`
6. **Update documentation** if needed
7. **Commit your changes** with conventional commits
8. **Push to your fork**
9. **Open a Pull Request** against `main`

### Pull Request Template

```markdown
## Description

[Describe what this PR does]

## Motivation

[Why is this change needed? What problem does it solve?]

## Changes

- [List key changes]
- [One per line]

## Testing

- [ ] Added unit tests
- [ ] Added integration tests (if applicable)
- [ ] All tests passing locally
- [ ] Lint passing locally

## Documentation

- [ ] Updated README if needed
- [ ] Updated CHANGELOG.md
- [ ] Added/updated TSDoc comments
- [ ] Updated relevant docs/ files

## Breaking Changes

[List any breaking changes, or write "None"]

## Related Issues

Closes #[issue number]
```

### Review Process

- **At least one approval** required from maintainers
- **All CI checks** must pass
- **No merge conflicts**
- **Code coverage** must not decrease
- Maintainers may request changes or ask questions

### Review Checklist (for reviewers)

- [ ] Code follows style guidelines
- [ ] Tests are comprehensive and pass
- [ ] Documentation is updated
- [ ] Commit messages follow conventions
- [ ] No breaking changes (or properly documented)
- [ ] Performance implications considered

---

## Release Process

Releases follow [Semantic Versioning](https://semver.org/):

- **MAJOR (x.0.0):** Breaking changes
- **MINOR (1.x.0):** New features (backward compatible)
- **PATCH (1.0.x):** Bug fixes

### Creating a Release (Maintainers Only)

1. **Update version** in package.json
2. **Update CHANGELOG.md** with release notes
3. **Commit changes**: `chore: bump version to 1.5.0`
4. **Create git tag**: `git tag v1.5.0`
5. **Push tag**: `git push origin v1.5.0`
6. **GitHub Actions** will automatically:
   - Run all tests
   - Build the package
   - Publish to npm (if configured)
   - Create GitHub release

---

## Development Tips

### Quick Commands

```bash
# Development workflow
npm run build:watch   # Auto-rebuild on changes
npm test -- --watch   # Auto-run tests on changes

# Code quality
npm run lint:fix      # Fix linting errors
npm run format        # Format code with Prettier
npm run typecheck     # Check TypeScript types

# Testing
npm run test:coverage  # Generate coverage report
npm run test:integration  # Run integration tests only

# Debugging
npm run build && node --inspect dist/server.js  # Debug with Chrome DevTools
```

### IDE Setup

**VS Code** (recommended):

```json
{
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "typescript.tsdk": "node_modules/typescript/lib"
}
```

**Debugging in VS Code:**

Add to `.vscode/launch.json`:

```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug ServalSheets",
  "program": "${workspaceFolder}/dist/server.js",
  "preLaunchTask": "npm: build",
  "env": {
    "NODE_ENV": "development",
    "LOG_LEVEL": "debug"
  }
}
```

### Common Issues

**Tests timing out:**

```bash
# Clean build fixes most issues
rm -rf dist && npm run build
npm test
```

**Import errors:**

```bash
# Ensure .js extensions in imports (ESM requirement)
import { foo } from "./foo.js";  // ✅
import { foo } from "./foo";     // ❌
```

**Coverage not updating:**

```bash
# Clear coverage cache
rm -rf coverage .nyc_output
npm run test:coverage
```

---

## Questions?

- **Bug reports:** [GitHub Issues](https://github.com/khill1269/servalsheets/issues)
- **Feature requests:** [GitHub Discussions](https://github.com/khill1269/servalsheets/discussions)
- **Security issues:** See [SECURITY.md](SECURITY.md)
- **Documentation:** [README.md](README.md), [docs/](docs/)

**Do not disclose security vulnerabilities in public issues.**

---

## License

By contributing to ServalSheets, you agree that your contributions will be licensed under the same license as the project (see [LICENSE](LICENSE) file).

---

## Acknowledgments

Thank you for contributing to ServalSheets! Your improvements help make this tool better for everyone in the MCP ecosystem.

**Contributors:**

- See [CONTRIBUTORS.md](CONTRIBUTORS.md) for the full list

---

**Happy coding!** 🎉

If you have any questions or need help getting started, don't hesitate to open a discussion or reach out to the maintainers.
