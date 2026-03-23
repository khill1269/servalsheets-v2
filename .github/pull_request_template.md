# Pull Request

## Description

<!-- Brief description of changes -->

## Type of Change

- [ ] Bug fix (non-breaking change fixing an issue)
- [ ] New feature (non-breaking change adding functionality)
- [ ] Breaking change (fix or feature causing existing functionality to change)
- [ ] Documentation update
- [ ] Performance improvement
- [ ] Code refactoring

## Multi-Agent Analysis Results

```bash
# Run before submitting:
npm run analyze:file <changed-files>
```

<!-- Paste multi-agent analysis summary here -->

## Validation Gates

- [ ] G0: Baseline Integrity (`Cmd+G Cmd+0` or `npm run gates:g0`)
- [ ] G1: Metadata Consistency (`Cmd+G Cmd+1` or `npm run gates:g1`)
- [ ] Tests passing (`Cmd+Shift+F` or `npm test`)
- [ ] No silent fallbacks (`npm run check:silent-fallbacks`)

## Checklist

- [ ] Code follows project style (auto-formatted with Prettier)
- [ ] Self-review completed
- [ ] Comments added for complex logic
- [ ] Documentation updated (if applicable)
- [ ] No breaking changes (or documented if necessary)
- [ ] All validation gates pass
- [ ] Multi-agent analysis shows no critical issues

## Screenshots (if applicable)

<!-- Add screenshots for UI changes -->

## Additional Notes

<!-- Any additional information for reviewers -->
