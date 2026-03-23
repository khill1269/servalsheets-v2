---
title: ServalSheets Documentation Index
category: development
last_updated: 2026-02-03
description: Complete documentation for ServalSheets v1.6.0
version: 1.6.0
tags: [prometheus, grafana, docker, kubernetes]
---

# ServalSheets Documentation Index

**Complete documentation for ServalSheets v1.6.0**

Welcome to the ServalSheets documentation! This index helps you find the right guide for your needs.

---

## 🚀 Getting Started (New Users)

Start here if you're new to ServalSheets:

| Document                                                             | Time   | Purpose                                 |
| -------------------------------------------------------------------- | ------ | --------------------------------------- |
| **[USAGE_GUIDE.md](../guides/USAGE_GUIDE.md)**                       | 20 min | Complete usage guide - read this first! |
| **[FIRST_TIME_USER.md](../guides/FIRST_TIME_USER.md)**               | 5 min  | Quick 5-minute start guide              |
| **[QUICKSTART_CREDENTIALS.md](../guides/QUICKSTART_CREDENTIALS.md)** | 10 min | How to get Google credentials           |
| **[CLAUDE_DESKTOP_SETUP.md](../guides/CLAUDE_DESKTOP_SETUP.md)**     | 15 min | Detailed Claude Desktop setup           |

**Recommended path**: FIRST_TIME_USER.md → QUICKSTART_CREDENTIALS.md → CLAUDE_DESKTOP_SETUP.md → USAGE_GUIDE.md

---

## 📖 Core Documentation

Essential reference documentation:

| Document                                                         | Purpose                                   | Audience             |
| ---------------------------------------------------------------- | ----------------------------------------- | -------------------- |
| **[README.md](../../README.md)**                                 | Overview, quick start, API reference      | All users            |
| **[CHANGELOG.md](../../CHANGELOG.md)**                           | Version history and breaking changes      | All users            |
| **[PROMPTS_GUIDE.md](../guides/PROMPTS_GUIDE.md)**               | 7 interactive prompts for Claude Desktop  | Claude Desktop users |
| **[SUBMISSION_CHECKLIST.md](../guides/SUBMISSION_CHECKLIST.md)** | Remote MCP submission readiness checklist | Developers/Ops       |

---

## 🤖 For AI Assistants

Documentation for AI assistants like Claude:

| Document                           | Purpose                                   | Audience                          |
| ---------------------------------- | ----------------------------------------- | --------------------------------- |
| **[SKILL.md](../guides/SKILL.md)** | How to use ServalSheets tools effectively | AI assistants (Claude, GPT, etc.) |

**Note**: SKILL.md is specifically written for AI assistants to understand how to use the 25 tools and 407 actions. It includes best practices, safety guidelines, and common patterns.

---

## 🔐 Production Deployment

Comprehensive guides for production deployments:

### Security

| Document                             | Lines | Topics Covered                                                                     |
| ------------------------------------ | ----- | ---------------------------------------------------------------------------------- |
| **[SECURITY.md](../../SECURITY.md)** | 3,482 | Token storage, authentication methods, key rotation, incident response, compliance |

**Key topics**:

- AES-256-GCM token encryption
- Service Account vs OAuth security
- Production deployment checklist
- Key rotation procedures
- Incident response plan (5 steps)
- Compliance (GDPR, CCPA, HIPAA, SOC 2)

### Performance

| Document                               | Lines | Topics Covered                                                                      |
| -------------------------------------- | ----- | ----------------------------------------------------------------------------------- |
| **[PERFORMANCE.md](./PERFORMANCE.md)** | 2,856 | Diff tiers, batch operations, rate limiting, caching, memory management, benchmarks |

**Key topics**:

- Diff tier selection (METADATA/SAMPLE/FULL)
- Batch operations (10-20x speedup)
- Rate limiting strategies
- Caching configuration (100x improvement)
- Memory optimization
- Performance benchmarks

### Monitoring

| Document                             | Lines | Topics Covered                                                        |
| ------------------------------------ | ----- | --------------------------------------------------------------------- |
| **[MONITORING.md](./MONITORING.md)** | 4,123 | Structured logging, metrics, health checks, APM, alerting, dashboards |

**Key topics**:

- Structured JSON logging
- Prometheus metrics integration
- Health checks (liveness/readiness/startup)
- APM integration (OpenTelemetry, Datadog, New Relic)
- Alert rules (quota, errors, latency)
- Grafana/CloudWatch dashboards

### Deployment

| Document                             | Lines | Topics Covered                                                                       |
| ------------------------------------ | ----- | ------------------------------------------------------------------------------------ |
| **[DEPLOYMENT.md](./DEPLOYMENT.md)** | 5,234 | Docker, Kubernetes, systemd, PM2, cloud platforms, load balancing, disaster recovery |

**Key topics**:

- Docker deployment (Dockerfile + docker-compose)
- Kubernetes manifests (complete setup with HPA)
- systemd service configuration
- PM2 process manager
- Cloud platforms (AWS ECS, Google Cloud Run)
- NGINX load balancing
- Backup and disaster recovery

### Troubleshooting

| Document                                       | Lines | Topics Covered                                                                            |
| ---------------------------------------------- | ----- | ----------------------------------------------------------------------------------------- |
| **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** | 3,892 | Authentication, rate limiting, permissions, performance, memory, network, MCP integration |

**Key topics**:

- Quick diagnostics procedures
- Authentication issues (failed auth, expired tokens)
- Rate limiting and quota errors
- Permission denied errors
- Performance issues (slow operations, high CPU)
- Memory issues (high usage, OOM crashes)
- Network connectivity problems
- MCP integration troubleshooting

---

## 🧪 Development & Testing

Documentation for developers and contributors:

| Document                                                                                | Purpose                                | Audience     |
| --------------------------------------------------------------------------------------- | -------------------------------------- | ------------ |
| **[TESTING.md](./TESTING.md)**                                                          | How to test locally before deployment  | Developers   |
| **[IMPLEMENTATION_GUARDRAILS.md](./IMPLEMENTATION_GUARDRAILS.md)**                      | Architecture and implementation phases | Contributors |
| **[MCP_2025-11-25_COMPLIANCE_CHECKLIST.md](../MCP_2025-11-25_COMPLIANCE_CHECKLIST.md)** | Requirements checklist                 | Contributors |
| **[SOURCE_OF_TRUTH.md](./SOURCE_OF_TRUTH.md)**                                          | Source-of-truth references             | Contributors |

---

## 📊 Analysis & Reports

Comprehensive analysis and audit reports:

| Document                                                                   | Lines  | Purpose                                                       |
| -------------------------------------------------------------------------- | ------ | ------------------------------------------------------------- |
| **[COMPREHENSIVE_ANALYSIS_REPORT.md](./COMPREHENSIVE_ANALYSIS_REPORT.md)** | 60,903 | Full source code analysis (97/100 production-readiness score) |
| **[DOCUMENTATION_IMPROVEMENTS.md](./DOCUMENTATION_IMPROVEMENTS.md)**       | 11,899 | Documentation improvements summary                            |
| **[PROJECT_AUDIT_REPORT.md](./PROJECT_AUDIT_REPORT.md)**                   | Latest | Complete project audit with critical findings                 |
| **[VERIFICATION_REPORT.md](./VERIFICATION_REPORT.md)**                     | 8,318  | Verification and compliance report                            |

---

## 📚 Documentation by Use Case

### "I'm a new user, where do I start?"

1. **[FIRST_TIME_USER.md](../guides/FIRST_TIME_USER.md)** - Your first 5 minutes
2. **[QUICKSTART_CREDENTIALS.md](../guides/QUICKSTART_CREDENTIALS.md)** - Get Google credentials
3. **[CLAUDE_DESKTOP_SETUP.md](../guides/CLAUDE_DESKTOP_SETUP.md)** - Set up Claude Desktop
4. **[USAGE_GUIDE.md](../guides/USAGE_GUIDE.md)** - Learn how to use everything

### "I want to deploy to production"

1. **[SECURITY.md](../../SECURITY.md)** - Security best practices
2. **[DEPLOYMENT.md](../guides/DEPLOYMENT.md)** - Choose deployment method
3. **[MONITORING.md](../guides/MONITORING.md)** - Set up observability
4. **[PERFORMANCE.md](../guides/PERFORMANCE.md)** - Optimize performance

### "I'm having issues"

1. **[TROUBLESHOOTING.md](../guides/TROUBLESHOOTING.md)** - Common issues and solutions
2. Enable debug logging: `export LOG_LEVEL=debug`
3. Check logs: `~/Library/Logs/Claude/mcp-server-servalsheets.log`
4. Open issue: https://github.com/khill1269/servalsheets/issues

### "I want to contribute"

1. **[IMPLEMENTATION_GUARDRAILS.md](./IMPLEMENTATION_GUARDRAILS.md)** - Architecture overview
2. **[MCP_2025-11-25_COMPLIANCE_CHECKLIST.md](../MCP_2025-11-25_COMPLIANCE_CHECKLIST.md)** - Requirements
3. **[SOURCE_OF_TRUTH.md](./SOURCE_OF_TRUTH.md)** - Source references
4. **[README.md](../../README.md)** - Development setup

### "I'm an AI assistant learning to use ServalSheets"

1. **[SKILL.md](../guides/SKILL.md)** - Complete tool usage guide for AI
2. **[README.md](../../README.md)** - API reference and examples
3. **[PROMPTS_GUIDE.md](../guides/PROMPTS_GUIDE.md)** - Interactive prompts

---

## 📦 What's Included in npm Package

When you install ServalSheets via npm (`npm install servalsheets`), you get:

### ✅ Included Files

- `dist/` - Compiled JavaScript and TypeScript definitions
- `server.json` - MCP server manifest
- `README.md` - Overview and quick reference
- `LICENSE` - MIT license
- **`SKILL.md`** - Guide for AI assistants
- **`USAGE_GUIDE.md`** - Complete usage guide
- **`FIRST_TIME_USER.md`** - 5-minute quick start
- **`SECURITY.md`** - Security best practices
- **`PERFORMANCE.md`** - Performance tuning
- **`MONITORING.md`** - Observability setup
- **`DEPLOYMENT.md`** - Deployment examples
- **`TROUBLESHOOTING.md`** - Common issues
- **`PROMPTS_GUIDE.md`** - Interactive prompts
- **`QUICKSTART_CREDENTIALS.md`** - Credential setup
- **`CLAUDE_DESKTOP_SETUP.md`** - Claude Desktop setup
- **`CHANGELOG.md`** - Version history
- **`DOCUMENTATION.md`** - This index

### 📍 GitHub Only

These files are available on GitHub but not in the npm package:

- Analysis reports (COMPREHENSIVE_ANALYSIS_REPORT.md, PROJECT_AUDIT_REPORT.md)
- Development guides (LOCAL_TESTING.md, IMPLEMENTATION_MAP.md)
- Build artifacts (COMPREHENSIVE_PLAN.md, ONBOARDING_COMPLETE.md)
- Compliance documents (COMPLIANCE_CHECKLIST.md, OFFICIAL_SOURCES.md)

**Full source and all documentation**: https://github.com/khill1269/servalsheets

---

## 🆘 Quick Help

### Common Questions

**Q: How do I install ServalSheets?**
A: `npm install -g servalsheets` then see [USAGE_GUIDE.md](./USAGE_GUIDE.md)

**Q: How do I get Google credentials?**
A: See [QUICKSTART_CREDENTIALS.md](./QUICKSTART_CREDENTIALS.md) - takes 2-10 minutes

**Q: How do I use with Claude Desktop?**
A: See [CLAUDE_DESKTOP_SETUP.md](./CLAUDE_DESKTOP_SETUP.md) - complete setup guide

**Q: ServalSheets not showing in Claude Desktop?**
A: See [TROUBLESHOOTING.md#mcp-integration](./TROUBLESHOOTING.md#mcp-integration)

**Q: How do I deploy to production?**
A: Read [SECURITY.md](./SECURITY.md) then [DEPLOYMENT.md](./DEPLOYMENT.md)

**Q: How do I optimize performance?**
A: See [PERFORMANCE.md](./PERFORMANCE.md) for tuning strategies

**Q: How do I monitor in production?**
A: See [MONITORING.md](./MONITORING.md) for logging, metrics, and alerts

**Q: I'm getting authentication errors**
A: See [TROUBLESHOOTING.md#authentication-issues](./TROUBLESHOOTING.md#authentication-issues)

**Q: I'm hitting rate limits**
A: See [TROUBLESHOOTING.md#rate-limiting-and-quotas](./TROUBLESHOOTING.md#rate-limiting-and-quotas)

### Getting Help

- **Documentation**: Start with [USAGE_GUIDE.md](./USAGE_GUIDE.md)
- **Troubleshooting**: [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
- **GitHub Issues**: https://github.com/khill1269/servalsheets/issues
- **Enable Debug Logs**: `export LOG_LEVEL=debug`
- **Check Logs**: `~/Library/Logs/Claude/mcp-server-servalsheets.log`

---

## 📈 Documentation Statistics

### Total Documentation

| Category              | Files  | Lines        | Purpose                   |
| --------------------- | ------ | ------------ | ------------------------- |
| **Getting Started**   | 4      | ~28,000      | New user onboarding       |
| **Core Docs**         | 3      | ~20,000      | Essential reference       |
| **Production Guides** | 5      | ~20,000      | Enterprise deployment     |
| **Development**       | 4      | ~50,000      | Developers & contributors |
| **Analysis**          | 4      | ~80,000      | Reports & audits          |
| **Total**             | **20** | **~200,000** | **Complete coverage**     |

### Documentation Quality

- ✅ **Comprehensive**: All use cases covered
- ✅ **Actionable**: Copy-paste examples throughout
- ✅ **Cross-referenced**: Documents link to each other
- ✅ **Production-tested**: Based on 16,851 lines of analyzed code
- ✅ **Up-to-date**: Version 1.6.0, MCP 2025-11-25 protocol

---

## 🔄 Documentation Version

**Version**: 1.6.0
**Protocol**: MCP 2025-11-25
**Last Updated**: 2026-01-30
**Status**: Production-ready

---

## 📝 Contributing to Documentation

Found an error or want to improve documentation?

1. **Open an issue**: https://github.com/khill1269/servalsheets/issues
2. **Submit a PR**: Fork, edit, and submit pull request
3. **Follow style**: Match existing documentation style
4. **Test examples**: Verify all code examples work

---

## License

All documentation is licensed under MIT, same as ServalSheets.

**ServalSheets v1.6.0** | **Production-Ready** | **MCP 2025-11-25**
