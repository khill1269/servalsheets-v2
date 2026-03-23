---
title: CI/CD Integration Test Setup
category: development
last_updated: 2026-01-31
description: This guide explains how to configure integration tests to run in GitHub Actions or other CI/CD environments.
version: 1.6.0
tags: [testing, setup, configuration, sheets, docker]
---

# CI/CD Integration Test Setup

This guide explains how to configure integration tests to run in GitHub Actions or other CI/CD environments.

## Overview

Integration tests can run in CI/CD pipelines using GitHub repository secrets to securely store credentials. This allows you to:

- Run integration tests on pull requests
- Verify API changes against real Google Sheets
- Catch breaking changes before deployment

## GitHub Actions Setup

### 1. Prepare Service Account Credentials

First, ensure you have a service account set up following the [Integration Test Setup Guide](./INTEGRATION_TEST_SETUP.md).

You'll need:

- Service account JSON file
- Test spreadsheet ID
- Test spreadsheet shared with the service account

### 2. Add GitHub Repository Secrets

1. Go to your GitHub repository
2. Click "Settings" > "Secrets and variables" > "Actions"
3. Click "New repository secret"

Add these secrets:

#### Required Secrets

**GOOGLE_TEST_CREDENTIALS**

- **Value**: The complete contents of your service account JSON file
- **Format**: Copy the entire JSON as-is

```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "test-account@your-project.iam.gserviceaccount.com",
  "client_id": "...",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "..."
}
```

**TEST_SPREADSHEET_ID**

- **Value**: Your test spreadsheet ID
- **Example**: `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms`

### 3. Create or Update GitHub Actions Workflow

Create or update `.github/workflows/test.yml`:

```yaml
name: Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run unit tests
        run: npm test

      - name: Setup integration test credentials
        if: ${{ secrets.GOOGLE_TEST_CREDENTIALS != '' }}
        run: |
          mkdir -p tests/config
          echo '${{ secrets.GOOGLE_TEST_CREDENTIALS }}' > tests/config/test-credentials.json
          # Update with test spreadsheet ID
          cat tests/config/test-credentials.json | \
            jq '.testSpreadsheet.id = "${{ secrets.TEST_SPREADSHEET_ID }}"' > tests/config/test-credentials.tmp.json
          mv tests/config/test-credentials.tmp.json tests/config/test-credentials.json

      - name: Run integration tests
        if: ${{ secrets.GOOGLE_TEST_CREDENTIALS != '' }}
        run: TEST_REAL_API=true npm test tests/integration/
        env:
          TEST_SPREADSHEET_ID: ${{ secrets.TEST_SPREADSHEET_ID }}

      - name: Cleanup credentials
        if: always()
        run: rm -f tests/config/test-credentials.json
```

### 4. Optional: Separate Integration Test Job

For better control, you can run integration tests in a separate job:

```yaml
jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm test

  integration-tests:
    runs-on: ubuntu-latest
    # Only run if secrets are configured
    if: ${{ secrets.GOOGLE_TEST_CREDENTIALS != '' }}
    needs: unit-tests

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - run: npm ci

      - name: Setup credentials
        run: |
          mkdir -p tests/config
          echo '${{ secrets.GOOGLE_TEST_CREDENTIALS }}' > tests/config/test-credentials.json

      - name: Run integration tests
        run: TEST_REAL_API=true npm test tests/integration/
        env:
          TEST_SPREADSHEET_ID: ${{ secrets.TEST_SPREADSHEET_ID }}

      - name: Cleanup
        if: always()
        run: rm -f tests/config/test-credentials.json
```

## Other CI/CD Platforms

### GitLab CI

Add to `.gitlab-ci.yml`:

```yaml
variables:
  TEST_REAL_API: 'true'

test:integration:
  stage: test
  script:
    - npm ci
    - mkdir -p tests/config
    - echo "$GOOGLE_TEST_CREDENTIALS" > tests/config/test-credentials.json
    - npm test tests/integration/
  after_script:
    - rm -f tests/config/test-credentials.json
  only:
    - main
    - merge_requests
  # Only run if secrets are configured
  rules:
    - if: '$GOOGLE_TEST_CREDENTIALS != ""'
```

Add these variables in GitLab:

- `GOOGLE_TEST_CREDENTIALS` (masked, protected)
- `TEST_SPREADSHEET_ID` (masked, protected)

### CircleCI

Add to `.circleci/config.yml`:

```yaml
jobs:
  integration-tests:
    docker:
      - image: cimg/node:20.0
    steps:
      - checkout
      - run:
          name: Install dependencies
          command: npm ci
      - run:
          name: Setup credentials
          command: |
            mkdir -p tests/config
            echo "$GOOGLE_TEST_CREDENTIALS" > tests/config/test-credentials.json
      - run:
          name: Run integration tests
          command: TEST_REAL_API=true npm test tests/integration/
      - run:
          name: Cleanup
          command: rm -f tests/config/test-credentials.json
          when: always

workflows:
  test:
    jobs:
      - integration-tests:
          context: integration-tests
```

Add environment variables in CircleCI project settings:

- `GOOGLE_TEST_CREDENTIALS`
- `TEST_SPREADSHEET_ID`

### Azure Pipelines

Add to `azure-pipelines.yml`:

```yaml
trigger:
  - main

pool:
  vmImage: 'ubuntu-latest'

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '20.x'

  - script: npm ci
    displayName: 'Install dependencies'

  - script: |
      mkdir -p tests/config
      echo '$(GOOGLE_TEST_CREDENTIALS)' > tests/config/test-credentials.json
    displayName: 'Setup credentials'
    condition: ne(variables['GOOGLE_TEST_CREDENTIALS'], '')

  - script: TEST_REAL_API=true npm test tests/integration/
    displayName: 'Run integration tests'
    condition: ne(variables['GOOGLE_TEST_CREDENTIALS'], '')
    env:
      TEST_SPREADSHEET_ID: $(TEST_SPREADSHEET_ID)

  - script: rm -f tests/config/test-credentials.json
    displayName: 'Cleanup credentials'
    condition: always()
```

## Security Best Practices

### 1. Protect Your Secrets

- Never log credentials or secrets in CI output
- Use masked/protected variables when available
- Always cleanup credential files after tests
- Use `if: always()` or equivalent to ensure cleanup runs

### 2. Limit Secret Access

- Only store secrets in protected branches (main, develop)
- Don't expose secrets to fork PRs
- Use environment-specific secrets for staging vs production

### 3. Rotate Credentials Regularly

- Regenerate service account keys quarterly
- Update secrets in CI/CD platform immediately
- Delete old keys from Google Cloud Console

### 4. Monitor API Usage

- Check Google Cloud Console for unexpected API calls
- Set up billing alerts
- Review audit logs regularly

### 5. Use Separate Test Projects

- Create dedicated Google Cloud projects for testing
- Don't use production service accounts
- Use test-specific spreadsheets only

## Troubleshooting

### Tests Skip in CI but Run Locally

- Verify `TEST_REAL_API=true` is set in CI
- Check that secrets are configured correctly
- Ensure secret names match exactly

### "Permission Denied" Errors

- Verify spreadsheet is shared with service account
- Check that Google Sheets API is enabled
- Ensure service account JSON is complete and valid

### Rate Limiting in CI

- Google Sheets API has rate limits (100 req/100s per user)
- Consider running integration tests less frequently
- Use `--max-workers=1` to run tests sequentially

### JSON Parsing Errors

- Ensure service account JSON is valid
- Check for proper escaping of special characters
- Verify no extra whitespace or newlines

## Example: Complete GitHub Actions Workflow

Here's a production-ready workflow with all best practices:

```yaml
name: Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  unit-tests:
    name: Unit Tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm test
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        if: always()

  integration-tests:
    name: Integration Tests
    runs-on: ubuntu-latest
    needs: unit-tests
    # Only run on main branch or if secrets are available
    if: |
      github.event_name == 'push' ||
      (github.event_name == 'pull_request' && secrets.GOOGLE_TEST_CREDENTIALS != '')

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Setup test credentials
        run: |
          mkdir -p tests/config
          cat > tests/config/test-credentials.json << EOF
          ${{ secrets.GOOGLE_TEST_CREDENTIALS }}
          EOF
          # Validate JSON
          node -e "JSON.parse(require('fs').readFileSync('tests/config/test-credentials.json', 'utf8'))"

      - name: Run integration tests
        run: TEST_REAL_API=true npm test tests/integration/
        timeout-minutes: 10
        env:
          TEST_SPREADSHEET_ID: ${{ secrets.TEST_SPREADSHEET_ID }}

      - name: Cleanup credentials
        if: always()
        run: |
          rm -f tests/config/test-credentials.json
          # Verify removal
          test ! -f tests/config/test-credentials.json

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: integration-test-results
          path: |
            coverage/
            test-results/
```

## Required Secrets Summary

For any CI/CD platform, you need:

| Secret Name               | Description               | Example                                        |
| ------------------------- | ------------------------- | ---------------------------------------------- |
| `GOOGLE_TEST_CREDENTIALS` | Full service account JSON | `{"type":"service_account",...}`               |
| `TEST_SPREADSHEET_ID`     | Test spreadsheet ID       | `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms` |

## Additional Resources

- [GitHub Actions Encrypted Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [Google Cloud Service Accounts](https://cloud.google.com/iam/docs/service-accounts)
- [Integration Test Setup Guide](./INTEGRATION_TEST_SETUP.md)

## Support

If you encounter issues:

1. Verify local tests work first
2. Check CI logs for specific errors
3. Validate secret configuration
4. Review Google Cloud Console for API errors
5. Test service account permissions manually
