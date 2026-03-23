# Incident Post-Mortem

> **Instructions:** Complete this template within 48 hours of incident resolution.
> File under `.github/INCIDENT_TEMPLATE/post-mortems/YYYY-MM-DD-{incident-title}.md`.

---

## Incident Summary

| Field | Value |
|-------|-------|
| **Incident ID** | INC-YYYY-NNN |
| **Severity** | P0 / P1 / P2 / P3 |
| **Status** | Resolved |
| **Start Time** | YYYY-MM-DD HH:MM UTC |
| **End Time** | YYYY-MM-DD HH:MM UTC |
| **Duration** | X hours Y minutes |
| **Detected By** | Alert / Customer Report / Internal |
| **Resolved By** | [Name] |
| **Affected Components** | e.g. sheets_data handler, OAuth flow |
| **User Impact** | e.g. "All API calls failing for 45 min", "Elevated latency for 10% of users" |

---

## Timeline of Events

> Use UTC timestamps. Include detection, escalation, mitigation, and resolution.

| Time (UTC) | Event |
|-----------|-------|
| HH:MM | Alert fired: `[AlertName]` |
| HH:MM | On-call acknowledged |
| HH:MM | Initial diagnosis: [hypothesis] |
| HH:MM | Escalated to [Name/Team] |
| HH:MM | Root cause identified: [brief description] |
| HH:MM | Mitigation applied: [action taken] |
| HH:MM | Service restored to normal |
| HH:MM | Incident declared resolved |

---

## Root Cause Analysis

### What happened?

> 1–3 sentences describing the root cause in plain language.

### 5 Whys

1. **Why** did users experience [symptom]?
   → Because [immediate cause]
2. **Why** did [immediate cause] occur?
   → Because [contributing factor 1]
3. **Why** did [contributing factor 1] occur?
   → Because [contributing factor 2]
4. **Why** did [contributing factor 2] occur?
   → Because [deeper cause]
5. **Why** did [deeper cause] exist?
   → Because [systemic gap]

### Contributing Factors

- [ ] Missing monitoring/alerting
- [ ] Insufficient test coverage
- [ ] Deployment/configuration error
- [ ] Upstream dependency failure
- [ ] Code defect
- [ ] Documentation gap
- [ ] Other: ___

---

## Impact Assessment

| Metric | Value |
|--------|-------|
| Users affected | ~N (estimated) |
| API calls failed | N |
| Data loss | None / Partial / Full |
| SLA breach | Yes / No |
| Requests to support | N |

---

## What Went Well

> Things that helped contain, detect, or resolve the incident faster.

-
-
-

---

## What Went Poorly

> Things that slowed detection, diagnosis, or resolution.

-
-
-

---

## Corrective Actions

> Each action must have an owner and a target date.

| Priority | Action | Owner | Target Date | Ticket |
|----------|--------|-------|-------------|--------|
| P0 | [Immediate fix] | @username | YYYY-MM-DD | #NNN |
| P1 | [Short-term improvement] | @username | YYYY-MM-DD | #NNN |
| P2 | [Long-term systemic fix] | @username | YYYY-MM-DD | #NNN |

---

## Lessons Learned

> What did this incident teach us? What would we do differently?

1.
2.
3.

---

## References

- Runbook used: `docs/runbooks/[runbook-name].md`
- Related alerts: `deployment/prometheus/alerts.yml`
- Trace IDs: `[requestId/traceId from logs]`
- Relevant PRs/commits: `[links]`
