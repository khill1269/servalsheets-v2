# Real-World Google Sheets Workflows for Production MCP Server

> Comprehensive research document mapping 8 user personas to 50+ end-to-end workflows.
> Identifies tool/action usage patterns, error scenarios, LLM intelligence opportunities,
> and wizard/elicitation points. Also includes cross-cutting test scenarios and
> edge cases critical to production readiness.
>
> **Research only — NO code changes.**
> Generated: 2026-03-19
> Status: Comprehensive analysis complete

---

## Table of Contents

1. [Persona 1: Financial Analyst](#persona-1-financial-analyst)
2. [Persona 2: Marketing Manager](#persona-2-marketing-manager)
3. [Persona 3: Sales Operations](#persona-3-sales-operations)
4. [Persona 4: Project Manager](#persona-4-project-manager)
5. [Persona 5: Data Engineer](#persona-5-data-engineer)
6. [Persona 6: Small Business Owner](#persona-6-small-business-owner)
7. [Persona 7: Educator](#persona-7-educator)
8. [Persona 8: HR Manager](#persona-8-hr-manager)
9. [Cross-Cutting Test Scenarios](#cross-cutting-test-scenarios)
10. [Error Scenario Taxonomy](#error-scenario-taxonomy)
11. [LLM Intelligence Opportunities](#llm-intelligence-opportunities)
12. [Wizard & Elicitation Opportunities](#wizard--elicitation-opportunities)

---

## Persona 1: Financial Analyst

**Profile**: Manages quarterly budgets, P&L reports, cash flow projections, variance analysis, multi-currency consolidation, forecast modeling.

**Pain Points**:

- Manual data entry from multiple sources (ERPs, banking APIs, operational spreadsheets)
- Formula errors in complex interdependent calculations
- Scenario modeling (5-way scenario comparisons for board presentations)
- Data consistency across regional books
- Month-end close on tight deadlines

### Workflow 1.1: Monthly Budget vs. Actual Variance Analysis

**Steps**:

1. Pull budget data from master budget spreadsheet (20+ line items)
2. Pull actual spending data from accounting system (via BigQuery connector)
3. Create variance columns (Actual - Budget, % Variance)
4. Flag items with >10% variance for investigation
5. Add conditional formatting (red for >10%, yellow for 5-10%)
6. Create summary dashboard with top variances
7. Share with stakeholders with comment-enabled sharing
8. Track changes during review cycle

**ServalSheets Actions Used**:

- `sheets_bigquery.connect` + `sheets_bigquery.query` — fetch actual data from accounting DB
- `sheets_data.cross_read` — merge budget + actual data on cost center ID
- `sheets_data.write` — populate variance formulas
- `sheets_format.set_number_format` — format as currency with 2 decimals
- `sheets_format.add_conditional_format_rule` — flag high variances
- `sheets_composite.build_dashboard` — summary KPI layout (top 10 variances, total variance, trend)
- `sheets_collaborate.share_add` — read+comment permissions for team
- `sheets_history.timeline` — view who changed what during review

**Error Scenarios**:

- BigQuery query timeout if dataset >1GB (should chunk or sample)
- Currency mismatch between sources (USD vs. EUR conversion)
- Duplicate cost center codes causing bad joins
- Missing actual data for month (incomplete accounting close)
- Formula circular reference if analyst adds row between budget and actual sections

**LLM Intelligence**:

- Suggest variance analysis: "Revenue variance is 15% — that's above your 10% threshold. Want me to flag line items?"
- Detect anomalies: "Cost of Goods Sold jumped 40% month-over-month. That's unusual for this time of year."
- Recommend reconciliation columns: "You have Budget, Actual, and Variance. Want me to add YTD columns for trend?"
- Suggest which columns to highlight: "Marketing and Supplies have high variances. Should I format those differently?"

**Wizard/Elicitation Points**:

- Elicit variance threshold: "What % variance should I flag as high?" (default 10%)
- Elicit fiscal period: "Is this monthly, quarterly, or annual?" (for correct grouping)
- Elicit currency conversions: "I see USD and EUR. What's the conversion rate for this period?"
- Confirm before cross-sheet merge: "I found cost center IDs in both sheets. Should I match on that?"

---

### Workflow 1.2: Quarterly Scenario Modeling (5 Scenarios)

**Steps**:

1. Start with current-year-to-date base model (150+ cells with interdependencies)
2. Build 5 scenarios: Base Case, Upside, Downside, Recession, Growth
3. Each scenario modifies: revenue growth %, COGS %, OpEx assumptions
4. Formulas cascade: Revenue → Gross Profit → EBITDA → FCF
5. Create side-by-side comparison (5 columns for each metric)
6. Add waterfall charts showing sensitivity
7. Create executive summary with key KPIs
8. Export for PowerPoint presentation

**ServalSheets Actions Used**:

- `sheets_dependencies.build` — map all formula dependencies
- `sheets_dependencies.model_scenario` — simulate each scenario (5x), showing impact cascade
- `sheets_dependencies.compare_scenarios` — side-by-side comparison with deltas
- `sheets_data.cross_read` — pull base assumptions from external sheets (macro assumptions)
- `sheets_visualize.chart_create` — waterfall charts for sensitivity (revenue vs. OpEx impact)
- `sheets_format.apply_preset` — consistent formatting across all scenarios
- `sheets_composite.export_xlsx` — export for presentation
- `sheets_composite.publish_report` — create shareable report with summaries

**Error Scenarios**:

- Circular formula references (e.g., revenue depends on volume, but volume calculated from revenue)
- Unsupported formula functions in scenario simulator (e.g., XIRR, IRR)
- Cell references that break when scenarios reordered
- Assumption sheet not locked → analysts change numbers during modeling
- Negative revenue edge case (discounts or refunds)

**LLM Intelligence**:

- Suggest scenario boundaries: "Your revenue ranges from 50M to 150M. Should I set Downside at -30% and Upside at +50%?"
- Detect formula gaps: "You're calculating EBITDA but no depreciation line. Missing something?"
- Rank scenario impact: "Growth scenario shows 25% EBITDA improvement. That's the biggest lever."
- Flag unrealistic outcomes: "Your FCF is negative in all scenarios. You might need to cut OpEx more."

**Wizard/Elicitation Points**:

- Confirm scenario names and key driver assumptions
- Set comparison metrics (which KPIs to compare across scenarios)
- Choose presentation format (side-by-side table vs. indexed to base case)

---

### Workflow 1.3: Multi-Currency P&L Consolidation

**Steps**:

1. Receive P&Ls from 8 regional entities (each in local currency: USD, EUR, GBP, JPY, etc.)
2. Convert all to reporting currency (USD) using month-end rates
3. Consolidate line by line (match account codes)
4. Handle inter-company eliminations (20+ elimination entries)
5. Build consolidated P&L + management reporting
6. Reconcile to GL (ensure no unmatched balances)
7. Audit for prior-month comparison

**ServalSheets Actions Used**:

- `sheets_data.cross_read` — read all 8 regional P&Ls, align on account structure
- `sheets_connectors.query` — fetch FX rates from external pricing API
- `sheets_data.write` — populate conversion formulas (local amount × FX rate)
- `sheets_data.find_replace` — normalize account codes across regions
- `sheets_format.suggest_format` — detect and format currency columns
- `sheets_dependencies.analyze_impact` — trace consolidation impact on key metrics
- `sheets_composite.audit_sheet` — identify unmatched rows and variances
- `sheets_quality.validate` — enforce: all amounts populated, no blank rows, FX rates reasonable

**Error Scenarios**:

- FX rates unavailable for last day of month (markets closed, rates delayed)
- Account code mismatch across regions (Region A uses "5100", Region B uses "510")
- Rounding errors in consolidation (accumulated penny differences)
- Inter-company transactions netted differently by each region
- Regional P&L timing misaligned (some accrued, some cash)
- Manual inter-company elimination entries entered with wrong sign

**LLM Intelligence**:

- Detect account code mismatches: "Region A has 47 accounts, Region B has 52. Found 5 unmatched: 5100 (Region A only), 5200 (Region B only)..."
- Suggest FX rate fallback: "JPY rates unavailable. Use yesterday's rate (99.50) or 30-day average (99.45)?"
- Identify rounding variances: "Consolidated Gross Profit is 5 cents off from line-item sum. Acceptable?"
- Flag suspicious eliminations: "Elimination entry DR 500K / CR 510K looks like typo. Did you mean DR/CR same account?"

**Wizard/Elicitation Points**:

- Confirm reporting currency and FX rate source
- Specify account matching rules (by code or by name similarity)
- Define rounding tolerance for variances
- Confirm inter-company elimination entries

---

### Workflow 1.4: Cash Flow Forecasting with Rolling Projections

**Steps**:

1. Start with 24-month rolling cash flow forecast (current month + 23 months forward)
2. Monthly structure: Operating CF (tied to revenue/COGS), CapEx, Debt payments, Dividends
3. Link revenue to sales forecast spreadsheet (update monthly)
4. Automatically roll (drop month 1, add month 25 each month)
5. Calculate minimum cash balance and covenant compliance
6. Flag months with negative CF (need financing)
7. Create trend chart (rolling 12-month average)

**ServalSheets Actions Used**:

- `sheets_data.cross_read` — pull revenue forecast from separate forecast sheet
- `sheets_data.write` — populate monthly CF formulas with proper date offsets
- `sheets_dimensions.sort_range` — ensure chronological order
- `sheets_format.set_number_format` — format as currency with parentheses for negative
- `sheets_format.add_conditional_format_rule` — highlight months with negative CF or covenant breach
- `sheets_visualize.chart_create` — trend chart of cumulative and monthly CF
- `sheets_dependencies.model_scenario` — "What if revenue 20% lower?" modeling
- `sheets_composite.export_large_dataset` — quarterly reporting export

**Error Scenarios**:

- Hardcoded dates in formulas (don't roll forward properly)
- Circular references if CF tied to minimum cash balance requirement
- Leap year issues (Feb has 28 or 29 days)
- Debt amortization table links broken when new debt added
- Revenue forecast outdated (not updated when sales changes)
- Covenant calculations use old balance sheet values

**LLM Intelligence**:

- Suggest rolling mechanism: "Want me to convert hardcoded dates to relative date formulas so this auto-rolls?"
- Identify under-forecast months: "July-September usually have higher OpEx. Your forecast is flat. Update?"
- Detect covenant risk: "At current pace, Debt/EBITDA hits 4.5x in Q3. That's above your 4.0x covenant."
- Suggest financing triggers: "You have 4 months with negative CF. Recommend credit facility of $20M."

**Wizard/Elicitation Points**:

- Confirm forecast horizon (24 months typical for corporates, 12 for small business)
- Specify covenant metrics and thresholds
- Define financing options available

---

### Workflow 1.5: Annual Budget Build & Consolidation

**Steps**:

1. Send budget templates to 12 department heads (separate sheets or separate workbook)
2. Each department submits: headcount plan, salary assumptions, department OpEx
3. Consolidate all into master budget (corporate overview)
4. Add corporate overhead allocations
5. Build full P&L (by revenue, COGS, and all OpEx categories)
6. Reconcile to prior-year actuals (ensure logical)
7. Build variance report vs. prior-year budget
8. Iterate based on C-suite targets
9. Lock and publish final budget

**ServalSheets Actions Used**:

- `sheets_composite.generate_template` — create reusable budget template for departments
- `sheets_data.append` — collect submissions from multiple department workbooks
- `sheets_data.deduplicate` — remove accidental duplicates (same dept submitted twice)
- `sheets_data.cross_read` — merge departmental budgets on org structure
- `sheets_format.apply_preset` — consistent formatting across all departments
- `sheets_advanced.add_protected_range` — lock formula rows (prevent accidental edits)
- `sheets_dimensions.freeze` — freeze headers for scrolling through 200+ line items
- `sheets_collaborate.comment_add` — C-suite feedback on budget items
- `sheets_history.version_create_snapshot` — snapshot after each review round
- `sheets_session.schedule_create` — recurring reminder email to departments if budget not submitted

**Error Scenarios**:

- Department submits budget in wrong year (copy-paste error from prior year)
- Salary increases don't align with company guidance (dept plans 5%, company targets 3%)
- HeadCount plan doesn't support revenue growth assumptions (understaffed)
- Duplicate headcount in multi-department projects
- Allocation basis changes mid-process (facilities overhead from square footage to headcount)
- Departments lock their submission sheet, preventing master consolidation
- Currency or units inconsistent (some in thousands, some in millions)

**LLM Intelligence**:

- Detect headcount/revenue mismatch: "Revenue forecast is +15% but headcount is flat. Usually adds 8-10% headcount for growth."
- Identify outlier departments: "Marketing is budgeting 25% increase vs. company average 3%. Reason documented?"
- Suggest allocation bases: "You have 12 departments. For facilities overhead, headcount allocation is standard."
- Flag validation gaps: "No budget submitted yet for IT and HR (today is day 5 of 10-day window)."

**Wizard/Elicitation Points**:

- Confirm budget cycle dates and department list
- Specify allocation methods (headcount-based, revenue-based, square footage)
- Set comparison metric (vs. prior year, vs. prior budget, vs. plan)
- Define escalation policies (salary increase %, merit increase %, cost-of-living adjustment)

---

### Workflow 1.6: Daily Cash Position Tracking

**Steps**:

1. Each morning, pull bank balances from 3 bank accounts (via API or manual entry)
2. Pull AR aging (from CRM system)
3. Pull AP aging (from accounting system)
4. Calculate net cash position
5. Track restricted cash separately
6. Compare to forecast (variance analysis)
7. Alert if actual < threshold

**ServalSheets Actions Used**:

- `sheets_data.append` — log daily balances (time-series data)
- `sheets_connectors.subscribe` — auto-refresh from bank APIs daily
- `sheets_data.cross_read` — merge AR + AP + bank data
- `sheets_format.set_number_format` — format as currency
- `sheets_format.add_conditional_format_rule` — red if below threshold
- `sheets_visualize.chart_create` — trend chart (30-day rolling view)
- `sheets_webhook.register` — alert via Slack if cash < $100K

**Error Scenarios**:

- Bank API delayed (2-hour lag, afternoon refresh shows stale balance)
- Weekend/holiday (no bank data, system shows prior day)
- Deposits in transit (recorded in AR but not yet in bank)
- AR/AP timing mismatches (invoice dated before payment sent)
- Multi-currency accounts (need to convert to reporting currency)
- Restricted cash treated as unrestricted

**LLM Intelligence**:

- Detect anomalies: "AR increased 25% week-over-week. Seasonal or collections issue?"
- Suggest liquidity forecasts: "At current burn rate, you have 90 days of cash. When's next funding?"
- Identify timing gaps: "AR aging shows 40% overdue >30 days. Collections follow-up recommended."

**Wizard/Elicitation Points**:

- Confirm alert thresholds (minimum cash balance)
- Specify bank accounts to track
- Define restricted vs. unrestricted cash categories

---

## Persona 2: Marketing Manager

**Profile**: Manages campaigns, budgets, lead scoring, attribution models, content calendars, performance dashboards, A/B testing.

**Pain Points**:

- Multiple campaign tracking spreadsheets across different platforms
- Attribution complexity (multi-touch, first-click vs. last-click)
- Budget spend pacing (on track vs. overspend)
- Lead scoring formula maintenance
- Content calendar synchronization
- Real-time performance dashboards for leadership

### Workflow 2.1: Multi-Channel Campaign Performance Dashboard

**Steps**:

1. Pull campaign data from 5 sources: Google Ads, Facebook Ads, LinkedIn, Email platform, Website analytics
2. Normalize metrics (impressions, clicks, conversions, cost, revenue)
3. Calculate KPIs: CTR, CPC, CPA, ROAS (Return on Ad Spend)
4. Create executive dashboard with:
   - Performance by channel (table)
   - Trend chart (weekly performance)
   - KPI cards (total spend, total conversions, avg ROAS)
   - Heatmap (best performing days/times)
5. Share with stakeholders (auto-updated daily)

**ServalSheets Actions Used**:

- `sheets_connectors.query` — fetch data from Google Ads API, Facebook API, Marketo
- `sheets_data.append` — log daily performance metrics (time-series)
- `sheets_data.cross_read` — merge campaigns across channels on match keys
- `sheets_format.set_number_format` — format spend as currency, CTR as percentage
- `sheets_visualize.chart_create` — trend charts, heatmaps
- `sheets_composite.build_dashboard` — KPI layout with 4 metrics cards + charts
- `sheets_collaborate.share_add` — read-only sharing with leadership team
- `sheets_webhook.subscribe_workspace` — auto-notification when ROAS drops below 2.0x

**Error Scenarios**:

- API keys expired (connector can't pull data)
- Campaign IDs changed in source system (data gaps or duplicates)
- Currency mismatches (some campaigns in EUR, some in USD)
- Conversion attribution window misaligned (click date vs. conversion date)
- Revenue data lags by 2 days (incomplete daily reconciliation)
- Platform API rate limits (quota exhausted mid-pull)

**LLM Intelligence**:

- Detect performance trends: "LinkedIn CTR is down 20% week-over-week. Budget reallocate to Google Ads (4x ROAS)?"
- Identify high-performing segments: "US campaigns have 3.5x ROAS; International is 1.2x. Reallocate budget to US?"
- Flag spend pacing issues: "Q1 budget is $50K. At current pace ($3K/day), you'll exceed by day 17. Slow down?"
- Suggest bid optimization: "CPC is rising but conversions flat. Suggest lowering bids on low-converting keywords."

**Wizard/Elicitation Points**:

- Confirm data sources and API keys
- Specify KPIs to track (ROAS vs. CPA vs. CAC)
- Define performance thresholds (underperforming < 2.0x ROAS)
- Choose dashboard layout and refresh frequency

---

### Workflow 2.2: Lead Scoring Model Maintenance

**Steps**:

1. Review lead scoring model (50+ attributes affecting score)
2. Update attributes based on latest insights:
   - Job title weight (adjusted based on conversion analysis)
   - Company size thresholds (updated on pipeline data)
   - Industry preferences (new priority industries)
   - Engagement signals (email opens, content downloads, form submits)
3. Test updated model on historical leads
4. Compare predicted quality vs. actual conversion (calibration)
5. Apply new model to incoming leads
6. Track model accuracy over time

**ServalSheets Actions Used**:

- `sheets_data.cross_read` — merge CRM lead data + conversion outcomes + engagement signals
- `sheets_analyze.analyze_data` — profile lead attributes and their correlation with conversion
- `sheets_data.write` — populate scoring formula (weighted sum)
- `sheets_compute.regression` — logistic regression to predict conversion probability
- `sheets_format.set_number_format` — format score as 0-100 scale, color by tier (A/B/C/D)
- `sheets_dimensions.sort_range` — rank leads by score
- `sheets_visualize.chart_create` — scatter plot (score vs. actual conversion rate)
- `sheets_quality.validate` — ensure no scoring edge cases (no negative scores, no >100)

**Error Scenarios**:

- Historical conversion data incomplete (some leads never followed up)
- New attributes with sparse data (insufficient sample to weight accurately)
- Scoring formula uses circular references (lead score feeds back into lead source)
- Outlier leads (unusually high score but never convert)
- Data staleness (lead attributes outdated, not refreshed from CRM)
- Attribute weight changes cause old leads' scores to shift unexpectedly

**LLM Intelligence**:

- Suggest attribute optimization: "Job title 'CTO' has 65% conversion rate but weight is only 8 points. Should be 20+."
- Detect scoring drift: "Model calibration on 2026-01 data. It's now 2026-03. Recommend recalibration with current data."
- Identify scoring blind spots: "High-scoring leads from India have 15% conversion, but high-scoring from US have 45%. Regional bias?"
- Suggest segmentation: "Leads split into 2 groups: 60% convert with score >70, 10% convert with score <70. Use threshold 70."

**Wizard/Elicitation Points**:

- Confirm lead attributes and their relative importance
- Specify conversion definition (what counts as "converted")
- Set target conversion rate for scoring tiers
- Choose model type (rule-based weights vs. statistical regression)

---

### Workflow 2.3: Content Calendar Sync & Editorial Workflow

**Steps**:

1. Maintain content calendar (50+ pieces planned for next quarter)
2. Track status: Planned → In Progress → Review → Published
3. Assign owners and deadlines
4. Trigger reminders when deadline approaching
5. Link to performance tracking (which content drives conversions)
6. Handle conflicts (multiple pieces competing for same date)

**ServalSheets Actions Used**:

- `sheets_core.create` — set up content calendar sheet
- `sheets_data.write` — populate calendar with pieces (date, title, owner, status, target channel)
- `sheets_dimensions.freeze` — freeze date column for easy scrolling
- `sheets_format.apply_preset` — alternating row colors for readability
- `sheets_format.add_conditional_format_rule` — highlight overdue items (red)
- `sheets_advanced.add_protected_range` — lock publish date once published
- `sheets_session.schedule_create` — daily reminder email to editors for pieces due today
- `sheets_collaborate.comment_add` — feedback during review stage
- `sheets_dimensions.sort_range` — sort by due date, prioritize urgent
- `sheets_data.cross_read` — link content to performance metrics (page views, conversions)

**Error Scenarios**:

- Scheduling conflicts (2 pieces scheduled for same channel on same date)
- Status updates lag (content published but status still "In Progress")
- Owner assignments unclear (multiple people think they own the piece)
- Performance data not linked to calendar (can't measure content ROI)
- Archive/version control missing (old calendar not accessible)
- Timezone issues (team in multiple zones, deadline ambiguous)

**LLM Intelligence**:

- Detect scheduling conflicts: "Blog and Webinar both scheduled for May 15. Usually limit to 1 per day."
- Suggest content gaps: "You have 8 product pieces, 3 thought leadership, 2 webinars. Balanced portfolio recommended."
- Identify bottleneck creators: "Sarah owns 18 pieces due in next 30 days. That's 2x her average. Overloaded?"
- Track content performance: "Blog posts on AI average 5,000 views. Cost per new lead is $25. Your best channel."

**Wizard/Elicitation Points**:

- Confirm content categories and channels
- Specify status workflow (how many stages, who approves each)
- Set reminder frequency (when to alert about upcoming deadlines)
- Define performance metrics to track

---

### Workflow 2.4: Budget Allocation Across Campaigns

**Steps**:

1. Receive total marketing budget for quarter ($500K)
2. Allocate to 6 campaigns based on projected ROAS
3. Track spend pacing (weekly actual vs. budgeted burn rate)
4. Reallocate if channels underperform (shift budget from 1.5x to 3.0x ROAS channels)
5. Report weekly: actual spend, committed spend, projected final spend
6. Alert if any campaign is 80%+ committed

**ServalSheets Actions Used**:

- `sheets_data.write` — set up budget allocation (campaign name, budget, start/end date, burn rate)
- `sheets_data.cross_read` — merge budget + actual spend data
- `sheets_format.set_number_format` — format budget and spend as currency
- `sheets_format.add_conditional_format_rule` — highlight 80%+ committed campaigns (yellow)
- `sheets_dependencies.model_scenario` — "What if we reallocate $100K from Channel A to Channel B?" modeling
- `sheets_visualize.chart_create` — burn rate chart (projected vs. actual)
- `sheets_composite.build_dashboard` — KPI cards (total budget, total spent, pacing status)
- `sheets_collaborate.comment_add` — discussion about reallocation decisions

**Error Scenarios**:

- Spend data lags by 2-3 days (invoices not processed)
- Campaign ID changes (platform renamed campaign mid-quarter)
- Budget doesn't match fiscal calendar (budget fiscal Q1, campaign runs on calendar Q1)
- Multiple invoices for same campaign (over-counting spend)
- Committed spend not captured (POs issued but not invoiced)
- Exchange rate fluctuations (international campaigns)

**LLM Intelligence**:

- Alert on pacing: "You're 1/3 through quarter but 55% of spend. You'll exceed budget by 5% if pace continues."
- Recommend reallocation: "Channel A has 1.2x ROAS, Channel B has 3.2x. Recommend moving $50K from A to B."
- Flag spending anomalies: "Influencer campaign just charged $80K (5x typical weekly spend). Correct?"

**Wizard/Elicitation Points**:

- Confirm quarterly budget and fiscal calendar
- Specify pacing model (linear, accelerating, back-loaded)
- Set alert thresholds (% committed threshold, pacing tolerance)

---

### Workflow 2.5: A/B Test Analysis & Results Reporting

**Steps**:

1. Design test: Control vs. Variant (different landing page, email subject, ad copy)
2. Collect data: sample size, conversion rate, revenue per visitor
3. Calculate statistical significance (p-value, confidence interval)
4. Determine winner
5. Write report: finding, business impact, recommendation
6. Implement winning variant

**ServalSheets Actions Used**:

- `sheets_data.write` — log test metadata (name, start date, control/variant, sample size)
- `sheets_data.append` — log daily results (conversions, revenue, sample size)
- `sheets_compute.statistical` — calculate conversion rate, standard deviation, confidence interval
- `sheets_compute.explain_formula` — explain statistical test results in plain language
- `sheets_format.set_number_format` — format as percentage (conversion rate)
- `sheets_format.add_conditional_format_rule` — highlight statistically significant results
- `sheets_visualize.chart_create` — cumulative conversion rate (watch convergence to winner)
- `sheets_composite.publish_report` — A/B test report with findings and recommendation

**Error Scenarios**:

- Sample size too small (results not statistically significant)
- Test duration too short (not enough data to declare winner)
- External factors skew results (holiday, competitor campaign, viral event)
- Sampling bias (test traffic not representative of overall traffic)
- Multiple comparisons problem (running 10 tests, false positive rate high)
- Carry-over effects (visitor exposed to both control and variant)

**LLM Intelligence**:

- Suggest sample size: "Current sample size is 1,500. Need 3,000 for 95% confidence at this effect size."
- Alert on inconclusive results: "Test has 2,000 samples but 95% CI is [-2%, +5%]. Run longer to narrow range."
- Identify winner early: "Variant has 35% conversion vs. Control 28%, already 99% confidence with 500 samples."
- Flag external factors: "COVID spike hit on day 5 of test. Consider re-running excluding outbreak period."

**Wizard/Elicitation Points**:

- Confirm test metric (conversion rate vs. revenue per visitor)
- Specify significance level (95% confidence vs. 99%)
- Set minimum detectable effect (if we see 10% improvement, is it worth rolling out?)

---

## Persona 3: Sales Operations

**Profile**: Manages sales pipeline, commission calculations, territory planning, CRM data sync, forecast reporting, rep performance tracking.

**Pain Points**:

- Pipeline visibility across multiple deal stages
- Commission calculation accuracy (base + bonus + accelerators)
- Territory alignment and fairness
- Forecast accuracy (bottom-up aggregation vs. top-down targets)
- Data quality (reps not updating CRM consistently)
- Real-time dashboards for sales leaders

### Workflow 3.1: Monthly Sales Commission Calculation

**Steps**:

1. Pull closed deals from CRM (date, amount, rep, deal category)
2. Apply commission rates by deal category (Standard 5%, Enterprise 3%, Services 8%)
3. Apply accelerators (if rep exceeds quota, 10% bonus above 100%)
4. Deduct chargebacks (if deal cancels within 12 months)
5. Calculate net commission per rep
6. Verify against prior month (spot check for anomalies)
7. Export for payroll

**ServalSheets Actions Used**:

- `sheets_connectors.query` — fetch closed deals from Salesforce/HubSpot
- `sheets_data.cross_read` — merge deals + commission rates + rep quotas
- `sheets_data.write` — populate commission calculation formulas
- `sheets_format.set_number_format` — format as currency
- `sheets_format.add_conditional_format_rule` — highlight reps exceeding quota
- `sheets_quality.validate` — ensure no deals missing category, all reps in mapping table
- `sheets_composite.audit_sheet` — identify unmatched deals or reps
- `sheets_history.diff_revisions` — compare to prior month (spot-check changes)
- `sheets_collaborate.share_add` — read-only access for finance team

**Error Scenarios**:

- Deal amount changed in CRM after commission calculated
- Rep reassigned after deal closed (who gets credit?)
- Deal marked as "closed" but still in negotiation (premature commission)
- Commission rates not updated for new deal categories
- Chargeback applied to deal months later (commission already paid)
- Rounding errors in accelerator calculation (accumulated fractions)
- Rep name spelled differently in CRM vs. payroll system

**LLM Intelligence**:

- Detect anomalies: "Rep A's commission is 40% higher than last month. New large deal or rate change?"
- Flag missing data: "5 deals missing category. Can't calculate commission. Auto-assign 'Standard' or wait for rep input?"
- Suggest quota pacing: "Rep B is at 85% of annual quota in month 9. Likely to exceed and get 10% accelerator."
- Identify unmatched reps: "3 reps in CRM don't exist in commission table. New hires not yet in system?"

**Wizard/Elicitation Points**:

- Confirm commission rate table and accelerator thresholds
- Specify deal categorization rules
- Define chargeback policy (time window, amount threshold)
- Confirm payroll calendar (when commission report due to finance)

---

### Workflow 3.2: Sales Pipeline Forecast (Next 3 Months)

**Steps**:

1. Roll up pipeline by stage: Prospecting, Qualification, Proposal, Negotiation, Closed-Won
2. Apply probability weight to each stage (Prospecting 10%, Qualification 30%, Proposal 60%, Negotiation 90%, Closed-Won 100%)
3. Calculate weighted forecast (sum of opportunity amount × stage probability)
4. Compare to target ($10M for quarter)
5. Identify shortfall or upside
6. Drill down by rep to find who's behind
7. Alert if forecast < 85% of target

**ServalSheets Actions Used**:

- `sheets_connectors.query` — fetch pipeline data from CRM (opportunity amount, stage, expected close date)
- `sheets_data.cross_read` — merge pipeline + rep quotas
- `sheets_dimensions.sort_range` — sort by close date, then by stage, then by amount
- `sheets_format.set_number_format` — format as currency
- `sheets_format.add_conditional_format_rule` — red if forecast < 85% of target
- `sheets_visualize.chart_create` — forecast trend (weekly update showing progression to target)
- `sheets_composite.build_dashboard` — forecast KPI card + rep-by-rep breakdown
- `sheets_analyze.quick_insights` — auto-detect pipeline gaps or unusual patterns

**Error Scenarios**:

- Pipeline data is 3 days stale (reps not updating CRM daily)
- Expected close date estimates are optimistic (always pushes out by 30 days)
- Won deals still in pipeline (not marked as closed)
- Duplicate deals (appeared twice due to CRM data sync issue)
- Stage definitions unclear (what's the difference between Proposal and Negotiation?)
- Probability weights not calibrated to actual conversion rates
- Pipeline includes aged opportunities (dead deals not cleaned up)

**LLM Intelligence**:

- Detect pipeline health: "You have 80 opportunities in Prospecting ($15M) but only 5 in Proposal ($800K). Conversion rates very low."
- Identify at-risk forecast: "Rep A has forecast of $500K but 70% in Negotiation (expected close in 45 days). High risk."
- Suggest early warnings: "Forecast confidence is only 78%. Recommend focusing on moving Qualification deals to Proposal."
- Flag stale deals: "Opportunity 'Acme Corp' in Negotiation for 180 days. Likely dead. Close it or it will distort forecast."

**Wizard/Elicitation Points**:

- Confirm pipeline stage definitions and typical timeline per stage
- Set probability weights per stage (based on historical conversion rates)
- Define forecast target and threshold for alert
- Specify which reps or regions to highlight

---

### Workflow 3.3: Territory Planning & Quota Allocation

**Steps**:

1. Map accounts to territories (geographic regions, industry verticals, customer size)
2. Allocate annual quota per territory ($1M for East Coast, $1.2M for West Coast, etc.)
3. Allocate rep within territory to focus on named accounts or new business
4. Track territory performance (actual revenue vs. quota)
5. Identify territory imbalances (some reps over-quota, some under)
6. Rebalance for next year

**ServalSheets Actions Used**:

- `sheets_core.create` — set up territory planning sheet
- `sheets_data.write` — populate accounts, territory assignments, quota allocations
- `sheets_data.cross_read` — merge accounts + territory + quota + YTD revenue
- `sheets_format.apply_preset` — color-code territories for easy visualization
- `sheets_dimensions.freeze` — freeze territory column for scrolling
- `sheets_format.add_conditional_format_rule` — highlight reps at >100% quota (green), <50% (red)
- `sheets_visualize.chart_create` — bar chart (rep performance vs. quota)
- `sheets_composite.audit_sheet` — identify unassigned accounts or over-assigned reps

**Error Scenarios**:

- Accounts assigned to multiple territories (conflict over who gets credit)
- Territory boundaries unclear (is this customer East Coast or Midwest?)
- Accounts move between territories (customer relocates or is acquired)
- Quota allocation not aligned to territory potential (East Coast gets $1M but has $3M opportunity)
- New accounts added during year (no territory assigned)
- Customer cross-sells handled by multiple reps (commission split unclear)

**LLM Intelligence**:

- Suggest rebalancing: "East Coast reps avg 92% quota, West Coast avg 68%. Recommend moving $150K quota from East to West."
- Identify territory opportunities: "Tech territory has $5M available opportunity but only $1.2M quota. Recommend $1.5M quota."
- Flag account conflicts: "Account 'XYZ Corp' is assigned to both East and Midwest. One territory needs to own it."
- Suggest fairness adjustments: "Rep A's accounts have 20% churn, Rep B's have 5%. Adjust Rep A's quota down 8%?"

**Wizard/Elicitation Points**:

- Confirm territory definitions and account assignment rules
- Specify quota allocation methodology (by revenue potential, by account count, by market size)
- Set rebalancing frequency (annual, semi-annual)

---

### Workflow 3.4: Sales Rep Performance & Coaching Dashboard

**Steps**:

1. Track rep metrics (YTD revenue, quota %, win rate, average deal size, sales cycle length)
2. Identify top performers and underperformers
3. Compare rep to peer group (what's typical?)
4. Identify coaching areas (if rep has low win rate, focus on negotiation skills)
5. Export for 1-on-1 coaching conversations

**ServalSheets Actions Used**:

- `sheets_connectors.query` — fetch rep activity from CRM (calls, meetings, proposals, wins)
- `sheets_data.cross_read` — merge activity + closed deals + quota data
- `sheets_compute.statistical` — calculate win rate, average deal size, sales cycle length
- `sheets_format.set_number_format` — format percentages and currency
- `sheets_format.add_conditional_format_rule` — red < 25th percentile, yellow 25-75th, green > 75th
- `sheets_visualize.chart_create` — rep ranking chart (win rate vs. deal size vs. cycle time)
- `sheets_composite.build_dashboard` — coaching dashboard with peer comparison
- `sheets_analyze.quick_insights` — auto-detect rep anomalies or best practices

**Error Scenarios**:

- Activity data incomplete (reps not logging calls/meetings in CRM)
- Deal attribution wrong (manager marked as closer, but rep did the work)
- Cohort comparisons unfair (comparing new hires to 10-year veterans)
- Metrics lag by week (reporting delay makes coaching stale)
- Seasonal effects masked (summer slump vs. actual performance decline)
- Turnover not accounted for (comparing partial-year reps to full-year)

**LLM Intelligence**:

- Identify coaching areas: "Rep A has high activity (50 calls/month) but low win rate (12%). Consider pitch coaching."
- Spot best practices: "Rep B closes deals 45% faster than peer average. Recommend reviewing her process."
- Flag retention risks: "Rep C's revenue is declining 3 months in a row. Engagement check recommended?"
- Suggest peer coaching: "Rep D has 35% win rate (best in team). Suggest mentoring Rep A."

**Wizard/Elicitation Points**:

- Confirm rep metrics and peer grouping (by geography, product line, tenure)
- Set performance thresholds (what's "good" win rate, deal size, cycle time)
- Choose peer comparison method (vs. team average, vs. best performer, vs. manager's peer)

---

## Persona 4: Project Manager

**Profile**: Manages project timelines, resource allocation, dependencies, milestones, status reporting, risk tracking, budget.

**Pain Points**:

- Gantt chart maintenance (dependencies, critical path)
- Resource overallocation (team member assigned to multiple projects)
- Timeline slippage (tracking delays and causes)
- Stakeholder communication (progress updates)
- Risk tracking (what could go wrong?)
- Budget tracking (actuals vs. estimate)

### Workflow 4.1: Project Gantt Chart with Dependency Management

**Steps**:

1. Create task list (50+ tasks for product launch)
2. Define dependencies (Task B can't start until Task A completes)
3. Estimate duration (in days) and assign owner
4. Calculate start/end dates based on dependencies
5. Identify critical path (sequence of tasks that determines project end date)
6. Flag tasks at risk of slipping
7. Update weekly with actual progress
8. Recalculate timeline and alert if end date changes

**ServalSheets Actions Used**:

- `sheets_core.create` — set up Gantt sheet with task names, owners, durations
- `sheets_data.write` — populate task dependencies (Task A → Task B)
- `sheets_dependencies.build` — map task dependencies (DAG: directed acyclic graph)
- `sheets_dependencies.detect_cycles` — alert if circular dependency created (Task A → B → A)
- `sheets_dependencies.get_dependencies` — query which tasks depend on each task
- `sheets_dimensions.sort_range` — sort by start date for chronological view
- `sheets_format.add_conditional_format_rule` — highlight critical path in red, at-risk tasks in yellow
- `sheets_visualize.chart_create` — Gantt chart visualization (timeline view)
- `sheets_data.write` — log weekly actuals (% complete per task)
- `sheets_dependencies.analyze_impact` — if Task A slips 5 days, what's the impact on end date?

**Error Scenarios**:

- Circular dependencies (Task A depends on B, B depends on A)
- Overlapping assignments (one person assigned to 3 tasks simultaneously)
- Duration estimates too optimistic (always take 20% longer than planned)
- Dependencies incomplete (forgot that Task C depends on Task B)
- Task duration unchanged after scope change
- Weekends/holidays not accounted for (7-day week when should be 5-day)
- Predecessor task delayed (pushes all dependent tasks downstream)

**LLM Intelligence**:

- Detect critical path risks: "Critical path is 90 days. Task 3 is on critical path and 20% at risk of slipping. Recommend: (1) Add buffer, (2) Increase resources, (3) Reduce scope."
- Suggest resource rebalancing: "Dev 1 has 8 concurrent tasks. Recommend: reassign Task 7 to Dev 2 (currently 2 tasks)."
- Flag schedule risks: "10 tasks are 1 week from start but haven't begun. Recommend soft escalation to owners."
- Identify bottleneck tasks: "Task 'Design' is blocking 5 downstream tasks. Highest priority."

**Wizard/Elicitation Points**:

- Confirm project scope and task list structure
- Specify working calendar (5-day week, holidays to exclude)
- Set critical path threshold (what % of slack = at-risk)
- Confirm milestone dates (hard deadlines)

---

### Workflow 4.2: Resource Allocation & Capacity Planning

**Steps**:

1. List all team members and their availability (hours per week)
2. List all active projects and their resource needs (hours per task)
3. Allocate people to projects
4. Identify overallocations (person assigned to more hours than available)
5. Identify idle capacity (people with spare time)
6. Rebalance to smooth workload
7. Track actual hours worked vs. planned

**ServalSheets Actions Used**:

- `sheets_core.create` — set up resource allocation sheet (people × projects)
- `sheets_data.write` — populate planned hours per person per project
- `sheets_format.set_number_format` — format as hours
- `sheets_format.add_conditional_format_rule` — red if person > 40 hours/week, yellow if > 35 hours
- `sheets_data.cross_read` — merge resource assignments + actual hours worked
- `sheets_compute.aggregate` — sum hours per person per week
- `sheets_dependencies.analyze_impact` — if person leaves project, how does timeline change?
- `sheets_visualize.chart_create` — stacked bar chart (hours per person, colored by project)

**Error Scenarios**:

- Hours estimate doesn't include overhead (meetings, email, admin)
- Some people on multiple projects (allocation adds up to 150%)
- People on personal development time (training, conference) not marked as unavailable
- Allocations in conflict (Design team allocated to both Project A and B, but they overlap)
- Actual hours exceed planned (scope creep or poor estimation)
- Vacation/leave not accounted for (person unavailable 2 weeks in month)

**LLM Intelligence**:

- Detect overallocation: "Dev 1 is allocated 48 hours/week across 3 projects. Can only work 40. Recommend: reassign 8 hours from Project C to Dev 2."
- Suggest capacity leveling: "Week 3-5, all devs are >45 hours. Week 6-8, all are <30 hours. Recommend: shift some tasks from W3 to W6."
- Identify bottleneck skills: "No one with AWS expertise available for month 2. Recommend: hire contractor or defer AWS tasks."

**Wizard/Elicitation Points**:

- Confirm working hours (40 hours/week, flexible, includes overhead?)
- Specify priority (which project takes precedence if resource conflicts)
- Set capacity target (should people be 80%, 90%, 100% allocated?)

---

### Workflow 4.3: Project Status & Milestone Reporting

**Steps**:

1. Each week, collect status from task owners (% complete, issues, risks)
2. Aggregate to project level (days on track, at-risk, behind schedule)
3. Calculate finish date variance (vs. original plan)
4. Summarize for steering committee
5. Escalate issues

**ServalSheets Actions Used**:

- `sheets_data.append` — log weekly status (% complete, blockers, risks)
- `sheets_format.add_conditional_format_rule` — color-code status (green on-track, yellow at-risk, red behind)
- `sheets_dependencies.model_scenario` — if current pace continues, when will project finish?
- `sheets_composite.publish_report` — weekly status report (summary + detail)
- `sheets_collaborate.comment_add` — discussion of risks and mitigation

**Error Scenarios**:

- Status estimates are optimistic (% complete inflates but actual progress stalls)
- Risk descriptions too vague (not actionable)
- Blockers not escalated quickly (waiting for decision)
- Status report delivers wrong message (team thinks project is on track, but critical risk unmentioned)
- Historical data lost (no archive of weekly reports)

**LLM Intelligence**:

- Detect optimism bias: "3 weeks ago, % complete was 30%, now 31%. At this pace, 100 weeks to finish. Red flag."
- Summarize risks: "3 risks this week: API integration, vendor delay, team unavailability. API is blockers #1."
- Suggest escalation: "2 open blockers this week (vs. 1 average). Recommend escalation to leadership."

**Wizard/Elicitation Points**:

- Confirm status update frequency (weekly, bi-weekly)
- Specify risk categories and scoring (high/medium/low impact/likelihood)
- Set reporting template and audience

---

### Workflow 4.4: Budget Tracking vs. Actuals

**Steps**:

1. Start with project budget ($500K for product launch)
2. Allocate budget by category: Labor (60%), Contractors (15%), Tools/Services (10%), Infrastructure (15%)
3. Track actuals monthly (invoices, timesheets)
4. Calculate variance (actual vs. budget)
5. Forecast final cost (if actuals so far are 30% over, project final will be 30% over)
6. Alert if forecasted final > budget + 10%

**ServalSheets Actions Used**:

- `sheets_data.write` — populate budget allocation by category
- `sheets_data.append` — log monthly actuals from invoicing system
- `sheets_format.set_number_format` — format as currency
- `sheets_format.add_conditional_format_rule` — red if actual > budget
- `sheets_dependencies.model_scenario` — forecast final cost based on actuals so far
- `sheets_visualize.chart_create` — budget vs. actual by category
- `sheets_composite.build_dashboard` — KPI cards (total budget, total spent, burn rate, EAC)

**Error Scenarios**:

- Invoices delayed (actuals lag by 30 days)
- Allocations change mid-project (budget for labor shifts to contractors)
- Shared services not allocated (infrastructure shared across projects)
- Expense categorization inconsistent (some labor as "Tools", some as "Labor")
- Forecast assumes same burn rate (but Q2 typically has fewer hours available)
- Currency fluctuations (contractors in EUR, budget in USD)

**LLM Intelligence**:

- Alert on budget risk: "Actuals are 35% over budget in month 2. If pace continues, final will be 35% over. Recommend: reduce scope or defer features."
- Suggest reallocation: "Labor is 40% under budget (good estimation), Tools is 60% over (added SaaS). Recommend: shift $50K from Labor to Tools."
- Flag spending spikes: "Contractor invoices jumped from $5K to $25K in month 3. Verify with project lead?"

**Wizard/Elicitation Points**:

- Confirm budget allocation methodology and categories
- Specify variance tolerance (how much over is acceptable?)
- Set alert thresholds

---

## Persona 5: Data Engineer

**Profile**: Builds data pipelines, ETL from various sources to warehouse, data quality validation, cross-spreadsheet analysis, BigQuery sync, schema management.

**Pain Points**:

- Data quality issues (missing values, outliers, duplicates)
- Schema alignment across sources
- Incremental loading (detecting changes)
- Dependency management (what dataset depends on what)
- Data lineage (track where data came from)
- Handling late-arriving data

### Workflow 5.1: ETL from Sheets to BigQuery

**Steps**:

1. Source data lives in Google Sheets (customer master, transaction log)
2. Validate data quality (no missing required fields, correct formats, no duplicates)
3. Flatten/transform (normalize column names, create surrogate keys)
4. Load to BigQuery (staging table, then merge to prod)
5. Data quality checks in BQ (row count match, no nulls where forbidden)
6. Archive Sheets (versioned copy for audit trail)

**ServalSheets Actions Used**:

- `sheets_quality.validate` — run validation rules (no nulls in ID field, date format correct, phone matches regex)
- `sheets_fix.detect_anomalies` — identify outliers (customer age > 120, transaction amount < 0)
- `sheets_fix.standardize_formats` — normalize phone numbers, dates, addresses
- `sheets_data.deduplicate` — remove duplicate customer records
- `sheets_composite.export_xlsx` — export cleaned data
- `sheets_bigquery.connect` — create connection to BigQuery
- `sheets_bigquery.export_to_bigquery` — load to BQ staging table
- `sheets_bigquery.query` — run data quality checks in BQ (SELECT COUNT(\*) where ID is null)
- `sheets_collaborate.version_create_snapshot` — archive Sheets for audit trail

**Error Scenarios**:

- Data validation rules catch issues → what's the fix? (drop rows, impute, escalate?)
- Schema mismatch between Sheets and BQ (Sheets has phone as text, BQ expects numeric)
- Late-arriving data (transaction happened today but Sheets updated 3 days later)
- Duplicates in source data (no unique identifier)
- NULL handling inconsistent (Sheets blank vs. BQ NULL vs. empty string)
- Data type precision loss (Sheets rounds numbers, BQ expects decimals)

**LLM Intelligence**:

- Suggest cleaning strategy: "5000 rows have phone number = 'unknown'. (1) Flag and drop, (2) Flag and escalate, (3) Apply rule-based parsing?"
- Detect data quality issues: "Customer age field has min=0, max=150, median=65. Age=0 likely missing data. Want to investigate?"
- Recommend normalization: "Phone field has formats: (XXX) XXX-XXXX, XXX-XXX-XXXX, XXXXXXXXXX. Standardize to E.164?"
- Identify late arrivals: "20 transactions dated 5 days ago, but only added to Sheets today. Should these be included in today's load?"

**Wizard/Elicitation Points**:

- Confirm validation rules (which fields are required, what formats are allowed)
- Specify data cleansing strategy (what to do with invalid/missing data)
- Set BigQuery table naming conventions
- Confirm BQ credentials and project

---

### Workflow 5.2: Multi-Source Data Integration

**Steps**:

1. Combine data from 4 sources: Google Sheets, Salesforce API, database query, CSV upload
2. Align schemas (same customer ID, date formats, currency)
3. Resolve conflicts (same customer in Salesforce and Sheets with different address)
4. Create unified view (merged dataset)
5. Track data lineage (which column came from which source)

**ServalSheets Actions Used**:

- `sheets_data.cross_read` — read from multiple Sheets
- `sheets_connectors.query` — fetch from Salesforce API
- `sheets_composite.import_csv` — load CSV file
- `sheets_data.write` — populate merged columns
- `sheets_data.find_replace` — normalize values (standardize state abbreviations)
- `sheets_quality.detect_conflicts` — identify where sources have conflicting data for same entity
- `sheets_advanced.add_metadata` — track lineage (column "Revenue_SF" marked as source "Salesforce")
- `sheets_composite.audit_sheet` — reconcile row counts, identify missing matches

**Error Scenarios**:

- Customer ID format different (Salesforce: SF-12345, Database: 12345)
- Same customer appears twice with different IDs (duplicate accounts not reconciled)
- Conflicting data (Salesforce says customer address is NYC, Sheets says LA)
- Late-arriving data (database updated after Sheets loaded)
- Source schema changes (new column added, old column removed)
- Join key cardinality mismatch (one customer in Sheets maps to 3 in Salesforce)

**LLM Intelligence**:

- Detect join issues: "Salesforce loaded 10,000 rows, Sheets loaded 9,500. 500 Salesforce customers not in Sheets. Manual match or okay?"
- Suggest join strategy: "Salesforce has account_id (unique), Sheets has account_name (non-unique). Recommend: load account mapping table first."
- Identify conflicts: "Customer 'ABC Corp' in Salesforce has address 'NYC', but Sheets says 'LA'. Which is source of truth?"
- Recommend reconciliation: "1,500 rows matched 1:1, 200 matched 1:N (1 Sheets row → multiple Salesforce rows). Want to split or aggregate?"

**Wizard/Elicitation Points**:

- Confirm data sources and connection details
- Specify join key (which field uniquely identifies each entity)
- Define conflict resolution (which source wins, or merge values)
- Set reconciliation tolerance (% of unmatched rows acceptable)

---

### Workflow 5.3: Data Quality Scorecard

**Steps**:

1. Define data quality dimensions: Completeness (% fields non-null), Accuracy (matches source), Timeliness (refresh rate), Consistency (across sources)
2. Measure each dimension weekly for key datasets
3. Calculate overall quality score (0-100)
4. Track trend (improving or degrading?)
5. Set SLAs (e.g., >95% completeness required)
6. Alert if SLA breached

**ServalSheets Actions Used**:

- `sheets_quality.analyze_impact` — comprehensive data quality analysis
- `sheets_data.append` — log weekly quality metrics
- `sheets_compute.statistical` — calculate % missing, % outliers, % duplicates
- `sheets_format.set_number_format` — format as percentage
- `sheets_format.add_conditional_format_rule` — green > SLA, red < SLA
- `sheets_visualize.chart_create` — trend chart (quality score over time)
- `sheets_composite.build_dashboard` — quality scorecard with all 4 dimensions

**Error Scenarios**:

- Quality metric definitions inconsistent (what counts as "complete"?)
- Metric calculation includes stale data (old records affect average)
- Seasonal patterns masked (Q4 always has lower completeness due to holiday data)
- SLA targets unrealistic (set at 99% but data naturally 95%)
- Metric latency (quality report is 1 week old)

**LLM Intelligence**:

- Detect quality degradation: "Completeness dropped from 98% to 92% in past 2 weeks. 8% of customer records missing email. Root cause?"
- Suggest SLA targets: "Current average completeness is 96%, min is 91%, max is 99%. SLA of 95% is reasonable."
- Identify dimension gaps: "Customer dataset is high quality (98% completeness) but Timeliness is low (1-week lag). Critical?"

---

### Workflow 5.4: Data Lineage & Dependency Tracking

**Steps**:

1. Map dataset dependencies (Dataset A feeds Dataset B feeds Dashboard C)
2. Track column-level lineage (which raw column ends up in which dashboard metric)
3. Detect breaking changes (if source schema changes, what downstream breaks?)
4. Plan migrations (before changing source schema, verify all consumers)

**ServalSheets Actions Used**:

- `sheets_dependencies.build` — create lineage graph
- `sheets_dependencies.get_dependents` — if I change table X, what breaks?
- `sheets_dependencies.get_dependencies` — if dashboard Y breaks, what could be the root cause?
- `sheets_dependencies.detect_cycles` — alert if circular dependency (should be DAG)
- `sheets_dependencies.export_dot` — export lineage graph for documentation
- `sheets_advanced.add_metadata` — tag columns with lineage info

**Error Scenarios**:

- Lineage incomplete (forgot to document manual consolidation step)
- Change not communicated (someone modifies table, downstream breaks, no one knows why)
- Circular dependencies hidden (table A feeds B, B feeds C, C feeds A through views)
- Undocumented dependencies (consumer didn't tell producer they depend on that field)

**LLM Intelligence**:

- Predict blast radius: "You want to rename column 'customer_id' to 'cust_id'. This column feeds 45 downstream queries. All will break unless updated."
- Suggest safe migration path: "Rather than rename, add new column 'cust_id' = 'customer_id'. Keep old column 2 versions for backward compatibility."
- Identify orphan datasets: "Table 'customer_archive' hasn't been read in 6 months. Can be archived or deleted?"

**Wizard/Elicitation Points**:

- Confirm critical datasets (which ones have SLAs?)
- Specify change notification process (how to alert consumers of schema changes)
- Define deprecation policy (how long to keep old version after renaming)

---

## Persona 6: Small Business Owner

**Profile**: Manages invoicing, inventory, employee scheduling, expense tracking, payroll, basic accounting, cash flow.

**Pain Points**:

- Manual data entry (invoices, expense reports)
- Inventory visibility (what's in stock, what's running low)
- Employee scheduling (who works when, labor costs)
- Tax calculation (sales tax, income tax withholding)
- Cash flow forecasting (will I run out of money?)
- Time tracking (how much time per project/customer)

### Workflow 6.1: Invoice Generation & Tracking

**Steps**:

1. Create invoice template (company name, terms, line items, tax)
2. For each customer order:
   a. Populate invoice number, date, customer, line items (description, qty, unit price, total)
   b. Calculate subtotal, tax, total
   c. Email to customer (with PDF)
   d. Track payment status (sent, overdue, paid)
3. Monthly: report on outstanding invoices

**ServalSheets Actions Used**:

- `sheets_composite.generate_template` — create reusable invoice template
- `sheets_data.write` — populate line items and calculations
- `sheets_format.set_number_format` — format amounts as currency
- `sheets_composite.export_xlsx` — export invoice to PDF for sending
- `sheets_data.append` — log invoice in master invoice tracking sheet
- `sheets_format.add_conditional_format_rule` — highlight overdue invoices (red if > 30 days)
- `sheets_data.write` — update payment status when customer pays
- `sheets_composite.publish_report` — monthly outstanding invoice report

**Error Scenarios**:

- Invoice number duplicated (not sequential)
- Tax calculation wrong (applied to incorrect items, wrong rate)
- Customer address missing or outdated
- Line item pricing incorrect (forgot to update for Q2 pricing change)
- Invoice delivered but not logged in tracking sheet (lost visibility)
- Payment received but not recorded (customer paid, still showing overdue)

**LLM Intelligence**:

- Suggest payment follow-up: "Invoice INV-0542 is 45 days overdue. Recommend follow-up call with customer."
- Detect pricing issues: "Line item cost is $100 but unit price is $80. That's negative margin. Correct?"
- Flag missing info: "Customer address field is blank on Invoice INV-0543. Can't print/email without it."

**Wizard/Elicitation Points**:

- Confirm invoice template (which fields required, header/footer info)
- Specify tax rules (sales tax rate, which items taxed)
- Set payment terms (net 30, net 60)
- Choose PDF format or email integration

---

### Workflow 6.2: Inventory Management & Reorder Alerts

**Steps**:

1. Maintain inventory master (product code, description, cost, reorder point)
2. Track inventory by location (warehouse, store, in-transit)
3. Update inventory on sale (reduce quantity)
4. Alert when inventory drops below reorder point
5. Calculate stock value (inventory × cost)
6. Monthly: reconcile physical count to system count

**ServalSheets Actions Used**:

- `sheets_core.create` — inventory master sheet
- `sheets_data.write` — populate products and reorder points
- `sheets_data.append` — log daily sales (reduce inventory)
- `sheets_data.write` — log purchases (increase inventory)
- `sheets_format.add_conditional_format_rule` — red if quantity < reorder point
- `sheets_compute.aggregate` — sum inventory value (qty × cost) by product and total
- `sheets_visualize.chart_create` — inventory trend (is stock growing or shrinking?)
- `sheets_dimensions.sort_range` — sort by reorder point (prioritize urgent)

**Error Scenarios**:

- Inventory not updated in real-time (lag between sale and inventory reduction)
- Reorder point not calibrated (set too high or too low)
- Waste/spoilage not tracked (inventory decreases but no sale)
- Multiple locations not reconciled (customer picking from wrong warehouse)
- New products added without initial inventory count
- Damaged goods not written off (inventory shows 100 units, but 5 damaged)

**LLM Intelligence**:

- Suggest reorder quantities: "Product X reorder point is 50 units. Lead time is 2 weeks. Average daily sales is 5 units. Reorder point should be 70 (2 weeks + buffer)."
- Detect slow-moving stock: "Product Y hasn't sold in 6 months. Still showing 200 units in inventory. Recommend: markdown or clearance?"
- Alert on stockouts: "Product Z sold 100 units last week but only 50 in stock. Stockout imminent. Urgent reorder needed?"

**Wizard/Elicitation Points**:

- Confirm product categories and reorder-point methodology
- Specify inventory locations and transfer rules
- Set safety stock levels
- Define reconciliation frequency (daily, weekly, monthly)

---

### Workflow 6.3: Employee Scheduling & Labor Cost Tracking

**Steps**:

1. Build employee master (name, hourly rate, availability)
2. Create weekly schedule (who works which days/hours)
3. Track actual hours worked (time clock, time tracking app)
4. Calculate labor cost (hours × rate)
5. Flag overscheduling (employee scheduled >40 hours)
6. Project weekly/monthly labor cost

**ServalSheets Actions Used**:

- `sheets_core.create` — employee and schedule sheets
- `sheets_data.write` — populate weekly schedule
- `sheets_format.apply_preset` — color-code by shift (morning, evening, night)
- `sheets_dimensions.freeze` — freeze employee names for scrolling
- `sheets_format.add_conditional_format_rule` — red if hours > 40
- `sheets_data.append` — log actual hours from time clock
- `sheets_compute.aggregate` — sum hours per employee, calculate labor cost
- `sheets_dimensions.sort_range` — sort by scheduled hours (find over-scheduled staff)

**Error Scenarios**:

- Schedule not finalized (employees don't know when they work)
- Actual hours exceed scheduled (overtime not pre-approved)
- Labor rate outdated (employees got raise, not updated)
- Multi-shift coverage gaps (no one scheduled for a shift)
- Schedule conflicts (manager scheduled for 2 places at once)
- Sick leave not accounted for (person called out, no replacement scheduled)

**LLM Intelligence**:

- Detect over-scheduling: "Employee A is scheduled 45 hours this week. Overtime not approved. Adjust schedule or adjust budget?"
- Suggest efficiency: "Labor cost is 35% of revenue. Industry standard is 25%. Consider: schedule fewer staff, increase prices, or reduce hours?"
- Flag staffing gaps: "Night shift Mon-Tue is uncovered (no one scheduled). Recommend: schedule 1 person or close that shift."

**Wizard/Elicitation Points**:

- Confirm employee rates and shift premiums
- Specify labor cost target as % of revenue
- Set overtime threshold and approval process
- Define shift structure (how many hours, which days)

---

### Workflow 6.4: Monthly Expense Tracking & Reimbursement

**Steps**:

1. Employees log expenses (customer meal, travel, supplies, etc.)
2. Categorize expenses (meals, travel, office, vehicle)
3. Flag for reimbursement approval
4. Calculate approved amount (policy: meals capped at $50/day, travel at actuals)
5. Process reimbursement payment
6. Track all expenses by employee and category

**ServalSheets Actions Used**:

- `sheets_core.create` — expense tracking sheet
- `sheets_data.append` — log employee expenses (date, category, amount, description, receipt)
- `sheets_data.write` — populate approved amount (apply policy rules)
- `sheets_format.set_number_format` — format as currency
- `sheets_format.add_conditional_format_rule` — red if exceeds policy (meal > $50)
- `sheets_data.find_replace` — normalize expense categories
- `sheets_composite.audit_sheet` — identify missing receipts or policy violations
- `sheets_quality.validate` — ensure amount > 0, date is valid, category is in approved list

**Error Scenarios**:

- Receipt missing (can't verify expense)
- Amount exceeds policy (meal for $150 when policy is $50)
- Duplicate entry (same receipt submitted twice)
- Personal expense miscategorized as business (dinner with family claimed as "client meal")
- Reimbursement delay (employees have to wait 60 days for payment)
- Exchange rate conversion for international travel (unclear how to handle)

**LLM Intelligence**:

- Flag policy violations: "Meal expense is $150 but policy is $50/day. Approved amount is $50. Remainder denied unless manager overrides?"
- Detect fraud patterns: "Employee A has submitted 5 'meals' in 5 days, all exactly at policy limit ($50 × 5 = $250). Suspicious coincidence?"
- Suggest policy refinement: "Average meal expense is $42. Policy ceiling is $50. Ceiling could be $45 and still approve 95% of expenses."

**Wizard/Elicitation Points**:

- Confirm expense categories and policy limits
- Specify approval process (who approves what amount)
- Set reimbursement frequency (weekly, bi-weekly, monthly)
- Confirm payment method (direct deposit, check, company card)

---

## Persona 7: Educator

**Profile**: Manages grades, attendance, student progress, parent communication, assignment planning, report cards.

**Pain Points**:

- Manual grade entry (100+ students, 20+ assignments)
- Grade calculation logic (weighted categories, extra credit)
- Student progress tracking (early intervention for struggling students)
- Parent communication (progress reports, alerts)
- Attendance tracking (absences, tardies, patterns)
- Differentiated instruction (tailored assignments by student level)

### Workflow 7.1: Grade Book Management & Reporting

**Steps**:

1. Set up grade book (students in rows, assignments in columns)
2. Define grading categories: Homework (30%), Quizzes (20%), Midterm (25%), Final (25%)
3. Enter individual grades
4. Calculate weighted category average
5. Calculate final course grade
6. Generate progress reports (interim grades, final grades)
7. Flag students with low grades (intervention needed)

**ServalSheets Actions Used**:

- `sheets_core.create` — grade book sheet
- `sheets_dimensions.freeze` — freeze student names and category headers
- `sheets_data.write` — populate assignment scores
- `sheets_format.set_number_format` — format as percentages (0-100)
- `sheets_format.add_conditional_format_rule` — red for D/F grades, yellow for C grades
- `sheets_data.write` — populate category average formulas (average homework, average quizzes, etc.)
- `sheets_data.write` — populate final grade formula (weighted average)
- `sheets_dimensions.sort_range` — sort by final grade (identify top/bottom students)
- `sheets_composite.publish_report` — progress report (individual student view)
- `sheets_quality.validate` — ensure all grades between 0-100, no missing required assignments

**Error Scenarios**:

- Grade entered as text instead of number (breaks average calculation)
- Extra credit not handled (final grade exceeds 100%)
- Incomplete grades (some students missing assignments, can't calculate average)
- Grade scale changed mid-semester (90-100 was A, now 93-100 is A)
- Rounding inconsistent (some calculations round, others truncate)
- Assignment weight changed retroactively (homework now 40% instead of 30%)

**LLM Intelligence**:

- Detect struggling students: "Student A has average of 62% (F grade). Falling further behind week-over-week. Recommend: intervention, tutoring, parent contact?"
- Suggest grade boundaries: "Grade distribution is skewed (15 As, 5 Bs, 30 Cs, 20 Ds, 10 Fs). Consider: exam too hard, need retake option?"
- Identify high performers: "Student B is 5 points above next student. Could compress grade scale or offer advanced track?"
- Flag missing data: "5 students missing Final Exam score. Can't calculate final grades without it."

**Wizard/Elicitation Points**:

- Confirm grading scale (90-100 A, 80-89 B, etc.)
- Specify grade category weights and rules
- Set progress report frequency (after each unit, every 2 weeks, etc.)
- Confirm student list and any special accommodations

---

### Workflow 7.2: Attendance Tracking & Pattern Analysis

**Steps**:

1. Maintain roster (student names, ID)
2. Daily: mark attendance (present, absent, tardy, excused)
3. Calculate monthly absence count
4. Flag excessive absences (chronic absenteeism, intervention)
5. Identify patterns (always absent on Mondays, skipping specific classes)
6. Report to administration

**ServalSheets Actions Used**:

- `sheets_core.create` — attendance sheet (students in rows, dates in columns)
- `sheets_data.write` — populate daily attendance (P/A/T/E codes)
- `sheets_format.apply_preset` — color-code (green=P, red=A, yellow=T)
- `sheets_dimensions.freeze` — freeze student names
- `sheets_compute.aggregate` — count absences per student per month
- `sheets_format.add_conditional_format_rule` — red if absences > 5 in month
- `sheets_dimensions.sort_range` — sort by absence count (identify chronic absentees)
- `sheets_analyze.detect_patterns` — identify patterns (always absent on Fridays, pattern indicates skipping)
- `sheets_composite.publish_report` — attendance report for administration

**Error Scenarios**:

- Attendance not taken consistently (one teacher marks daily, another weekly)
- Code ambiguity (is "A" absence or "approved"?)
- Excused vs. unexcused not tracked (affects intervention threshold)
- Weekend dates included (Tuesday-Thursday attendance is relevant, not weekends)
- Illness absences not captured (can't distinguish from truancy)
- Late arrivals not counted as tardies (student shows up during 2nd period)

**LLM Intelligence**:

- Detect truancy: "Student A has 8 absences in month 1 (6% of school days). All unexcused. Escalate to principal?"
- Identify patterns: "Student B is absent every Friday 3 months in a row. Suggests non-attendance or sporting events. Investigate?"
- Suggest intervention: "Students with >10 absences have 2x higher failure rate. Early intervention recommended."

**Wizard/Elicitation Points**:

- Confirm attendance codes (P, A, T, E, etc.)
- Specify intervention triggers (how many absences = escalation)
- Set reporting frequency and audience

---

### Workflow 7.3: Assignment Planning & Differentiated Instruction

**Steps**:

1. Plan assignments for semester (dates, topics, due dates)
2. Differentiate by student level (advanced, grade-level, below-level)
3. Assign to students based on current performance
4. Track submission (on-time, late, incomplete)
5. Analyze class trends (which topics struggling, which mastered)

**ServalSheets Actions Used**:

- `sheets_core.create` — assignment plan sheet (assignment date, topic, level)
- `sheets_data.write` — assign to students (student name, assignment, due date, level)
- `sheets_format.apply_preset` — color-code by level (blue=advanced, green=grade-level, red=below-level)
- `sheets_dimensions.sort_range` — sort by due date
- `sheets_data.append` — log submission status (date submitted, on-time/late/missing)
- `sheets_analyze.detect_patterns` — which topics have low submission rates?
- `sheets_composite.publish_report` — assignment plan for parents (upcoming assignments)

**Error Scenarios**:

- Assignment too easy or too hard for student level (discourages engagement)
- Differentiation not transparent (advanced students feel slighted, below-level students feel singled out)
- Due dates conflict (student has 3 due dates on same day)
- Submission tracking incomplete (teacher doesn't mark if submitted on time)
- Feedback loop missing (student doesn't know why assignment was below-level)

**LLM Intelligence**:

- Suggest differentiation: "Based on recent grades, recommend: Student A (grade 95%) advanced assignment, Student B (grade 72%) grade-level."
- Identify overload: "Week of March 15, students have 4 major assignments due. Recommend: stagger due dates?"
- Detect topic struggles: "Fractions unit has 40% submission rate. Below-level students average 60%, grade-level 35%. Topic too hard for grade-level."

**Wizard/Elicitation Points**:

- Confirm differentiation levels and assignment structure
- Specify assignment due date distribution
- Define late submission policy

---

## Persona 8: HR Manager

**Profile**: Manages headcount planning, compensation, hiring, onboarding, org charts, performance reviews, benefits enrollment.

**Pain Points**:

- Headcount forecasting (budget headcount vs. actual hires)
- Compensation equity (equal pay for equal work across teams)
- Org chart maintenance (who reports to whom)
- Hiring pipeline (how many candidates at each stage)
- Performance rating distribution (biased toward high ratings or low?)
- Benefits enrollment and cost tracking

### Workflow 8.1: Headcount Planning & Budget Forecasting

**Steps**:

1. Current headcount (150 employees across 5 departments)
2. Planned hires (20 new roles approved for 2026)
3. Planned departures (estimate 12% turnover = 18 employees)
4. Forecast: 150 + 20 - 18 = 152 employees by year-end
5. Align to budget (budget assumes 150, need to adjust for 2 more)
6. Track actual vs. plan (weekly headcount actuals)

**ServalSheets Actions Used**:

- `sheets_core.create` — headcount planning sheet
- `sheets_data.write` — populate by department, role, status (current, approved hire, planned departure)
- `sheets_dimensions.freeze` — freeze department and role columns
- `sheets_compute.aggregate` — sum headcount by department, total
- `sheets_format.set_number_format` — format as headcount (no decimals)
- `sheets_format.add_conditional_format_rule` — highlight if actual > plan by 5%
- `sheets_data.append` — log monthly actuals (hires, departures)
- `sheets_dependencies.model_scenario` — if we hit only 80% of hiring targets, final headcount?

**Error Scenarios**:

- Approved hires not actually filled (no candidate accepted)
- Turnover estimates too low (higher than 12% actual)
- Departures not communicated (someone left but still on plan)
- Seasonality not accounted for (Q4 hires delay to Q1)
- Budget assumptions outdated (head count approved 6 months ago, now changed)

**LLM Intelligence**:

- Detect hiring lag: "You've approved 20 hires but only 3 completed offer stage. At current pace, only 12 hired by year-end. Recommend: speed up sourcing?"
- Flag turnover risk: "2 of your highest performers just left (that's 4x voluntary turnover). Investigate: compensation, management, culture?"
- Suggest budget impact: "If headcount hits 160 (vs. planned 150), labor cost increases $2M. Budget adjustment needed?"

**Wizard/Elicitation Points**:

- Confirm headcount plan by department
- Specify hiring timeline (when roles need to be filled)
- Set turnover assumptions by role (engineers turnover different than operations)

---

### Workflow 8.2: Compensation Equity Analysis

**Steps**:

1. Collect compensation data (salary, bonus, equity by employee)
2. Analyze by gender, race, tenure, role (checking for disparities)
3. Calculate median salary by role and compare to market benchmark
4. Flag outliers (someone paid 30% above/below peer group)
5. Recommend adjustments (raise low-paid staff, budget impact)

**ServalSheets Actions Used**:

- `sheets_data.write` — populate compensation data (anonymized: Employee ID, Role, Salary, Gender, Race, Tenure, Market Rate)
- `sheets_compute.statistical` — median salary, std deviation by role and demographic
- `sheets_analyze.detect_patterns` — are women paid less than men in same role?
- `sheets_format.set_number_format` — format as currency
- `sheets_format.add_conditional_format_rule` — highlight if actual > market rate + 15%
- `sheets_dimensions.sort_range` — sort by salary (identify high/low outliers)
- `sheets_quality.validate` — ensure no duplicate Employee IDs
- `sheets_composite.publish_report` — equity analysis report

**Error Scenarios**:

- Compensation data incomplete (some people missing bonus or equity)
- Market benchmarks outdated or wrong sourced
- Outliers valid (high performer, special circumstances) vs. systemic bias
- Confounding variables (someone paid more because promoted earlier)
- Bonus/equity structure inconsistent (some people have bonus, others don't)

**LLM Intelligence**:

- Detect equity gaps: "Women in Engineering role have median salary $120K, men $135K (11% gap). Recommend: audit hiring/promotion process, consider adjustments."
- Identify budget impact: "To bring all employees to market rate (within 5%), need $500K adjustment. Feasible?"
- Suggest adjustment strategy: "Rather than one-time adjustment, recommend: prioritize raises for lowest-paid 20%, 2-year plan."

**Wizard/Elicitation Points**:

- Confirm demographic data to include (gender, race, tenure)
- Specify market benchmark source
- Set equity gap tolerance (e.g., acceptable range is ±5% of median)

---

### Workflow 8.3: Hiring Pipeline Tracking

**Steps**:

1. Track all open requisitions (role, team, urgency, approved budget)
2. Track candidate stage: Applied → Screening → Phone → Onsite → Offer → Accepted → Started
3. Calculate conversion rates by stage (how many apply, how many move to next stage)
4. Forecast time-to-hire (average days in each stage)
5. Identify bottlenecks (lots of onsite candidates but no offers)

**ServalSheets Actions Used**:

- `sheets_core.create` — requisition tracker and candidate pipeline
- `sheets_data.append` — log candidates (name, role, stage, days in stage)
- `sheets_dimensions.sort_range` — sort by stage and days (identify candidates delayed)
- `sheets_format.add_conditional_format_rule` — red if interview pending >2 weeks
- `sheets_compute.aggregate` — count candidates by stage and role
- `sheets_analyze.detect_patterns` — which roles have slowest hiring process?
- `sheets_visualize.chart_create` — pipeline funnel (how many candidates at each stage)
- `sheets_composite.publish_report` — hiring dashboard (open reqs, stage breakdown, forecast)

**Error Scenarios**:

- Candidate stage not updated (still showing "Screening" but already rejected)
- Duplicate candidates (same person applied twice)
- Open reqs without assigned budget (can't hire)
- Interview feedback not documented (hiring manager forgets details)
- Offer extended but not accepted (candidate ghosted or counter-offer accepted)
- Candidate information sensitive (HR needs to restrict access)

**LLM Intelligence**:

- Identify bottleneck: "Engineering pipeline has 20 applicants (100), 4 reached onsite (20% conversion). Industry average is 40%. Recommend: adjust screening criteria or recruiter approach?"
- Forecast hiring: "Current pace, Engineer role will be filled in 60 days. Budget approved for 3 engineers, on pace for 2 by year-end. Recommend: speed up sourcing?"
- Suggest process improvement: "Offer-to-acceptance rate is 60%. That's below 80% industry average. Recommend: improve offer package or competing offers?"

**Wizard/Elicitation Points**:

- Confirm hiring pipeline stages
- Specify time-to-hire targets by role
- Set conversion rate expectations by stage
- Define candidate data privacy and access controls

---

### Workflow 8.4: Performance Rating Distribution Analysis

**Steps**:

1. Collect performance ratings (1-5 scale, or percentile ranking)
2. Analyze distribution by manager, department, tenure, gender
3. Flag biases (one manager rates everyone 5, another everyone 3)
4. Compare to bell curve (expect ~10% 5s, ~25% 4s, ~30% 3s, ~25% 2s, ~10% 1s)
5. Recommend calibration (discussions to ensure fair ratings)

**ServalSheets Actions Used**:

- `sheets_data.write` — populate rating data (Employee ID, Manager, Rating, Department, Tenure)
- `sheets_analyze.detect_patterns` — do ratings vary by manager/department/gender?
- `sheets_compute.statistical` — rating distribution (histogram)
- `sheets_format.add_conditional_format_rule` — flag if manager's ratings too high (>80% above-average) or too low
- `sheets_visualize.chart_create` — rating histogram vs. bell curve
- `sheets_quality.validate` — ensure rating between 1-5, no missing ratings
- `sheets_composite.publish_report` — rating analysis for HR discussion

**Error Scenarios**:

- Ratings inflated (everyone rated 4-5, no feedback for improvement)
- Ratings biased by protected characteristic (women systematically lower than men)
- Ratings inconsistent with actual performance (someone rated 4 but on PIP)
- Rater not trained (manager doesn't understand rating scale)
- Rating system changed (new 1-5 scale vs. old percentile system)

**LLM Intelligence**:

- Detect rating inflation: "Department A average rating is 4.2/5 (84% above-average). Recommend: calibration session with managers to align standards."
- Identify gender bias: "Men in role X average 4.1, women average 3.6. Statistically significant difference. Recommend: review of specific ratings."
- Flag outlier raters: "Manager A rated everyone 3 (no one above/below). Manager B rated everyone 4+ (no growth opportunity). Both need recalibration."

**Wizard/Elicitation Points**:

- Confirm rating scale and definitions
- Specify demographic categories to analyze
- Set expected distribution (bell curve or other)
- Define calibration process and participants

---

## Cross-Cutting Test Scenarios

### Scenario A: Multi-User Concurrent Editing

**Setup**: 3 users editing the same spreadsheet simultaneously

- User 1: Adding revenue forecast data (rows 50-150)
- User 2: Creating expense formulas (columns D-F)
- User 3: Adding conditional formatting

**Expected Behavior**:

- All changes persisted (no lost updates)
- No formula corruption
- Formatting applied correctly across all cells
- No timeout or rate-limit errors

**ServalSheets Actions**:

- `sheets_data.write` — batched writes from 3 sources should be conflict-free
- `sheets_format.batch_format` — multiple format requests should queue/batch correctly
- `sheets_quality.detect_conflicts` — should identify and resolve conflicts
- `sheets_history.timeline` — should capture all 3 users' changes in order

**Error Scenarios**:

- Write conflicts (User 1 and 2 both write to same cell at same time)
- Formula dependencies broken (User 2 adds formula before User 1 adds data)
- Rate limiting (Google Sheets API blocks concurrent writes)
- Connection drop (one user loses connection mid-edit)
- Stale cache (one user's changes not visible to others for 30s)

**LLM Intelligence Opportunities**:

- Suggest lock/reservation: "User 2 is editing formulas, User 1 is changing data. Recommend: lock formula rows while editing."
- Detect conflict risk: "3 concurrent edits to same region. High conflict risk. Suggest: use separate ranges or transaction mode."

---

### Scenario B: Very Large Spreadsheet (10K+ Rows, 100+ Columns)

**Setup**: Budget consolidation with 15,000 line items

**Expected Behavior**:

- Data operations complete in <10 seconds
- Formulas evaluate without timeout
- Filtering/sorting responsive
- No out-of-memory errors

**ServalSheets Actions**:

- `sheets_dimensions.sort_range` — sort 15K rows should be fast
- `sheets_data.batch_read` — read 15K rows in reasonable time
- `sheets_compute.aggregate` — sum 15K rows (formula evaluation)
- `sheets_dimensions.set_basic_filter` — filter on 15K rows should be fast
- `sheets_analyze.comprehensive` — analyze 15K rows (may timeout)

**Error Scenarios**:

- Sort operation times out (>30s)
- Filter view creation times out
- Formula references all 15K rows (circular definition risk)
- Export times out (XLSX conversion slow)
- Charts on 15K rows are unresponsive
- Search/find operations are slow

**LLM Intelligence Opportunities**:

- Suggest data stratification: "15K rows is large for single sheet. Consider: split by region (3 sheets) for better performance."
- Recommend chunking: "Sorting 15K rows takes 20s. Recommend: sort by date first (subset), then by category."
- Optimize formulas: "SUM formula references all 15K rows. Only first 100 rows have data. Optimize range to 1:100."

---

### Scenario C: Cross-Spreadsheet Operations

**Setup**: Consolidating 5 regional spreadsheets into 1 master

**Expected Behavior**:

- `cross_read` successfully merges 5 datasets
- No duplicate accounts or missing matches
- Join key mismatches identified and reported
- Performance acceptable (<5s for 5 spreadsheets)

**ServalSheets Actions**:

- `sheets_data.cross_read` — read from 5 spreadsheets
- `sheets_data.cross_compare` — compare regions for variance
- `sheets_data.write` — consolidate into master
- `sheets_quality.validate` — ensure consolidated data integrity

**Error Scenarios**:

- Spreadsheet IDs incorrect or sheets don't exist
- Join key not found in one source
- Account codes different across regions (can't match)
- Currency mismatches (some USD, some EUR)
- One source has more recent data than others
- Row count mismatch (detected but unclear why)

**LLM Intelligence Opportunities**:

- Suggest join strategy: "Found 500 accounts in East region, 450 in West. 50 unmatched. Manual review or okay?"
- Detect data quality issues: "East region has 20 null account names. West has 0. Suggest: review East data quality."

---

### Scenario D: Permission & Sharing Workflows

**Setup**:

- Manager shares budget spreadsheet with team (read + comment)
- Finance approves changes (requires specific permissions)
- Contractor gets limited access (only one sheet)

**Expected Behavior**:

- Permissions enforced consistently
- Contractor can't see other sheets
- Comments visible to permitted users only
- Audit trail tracks who has access

**ServalSheets Actions**:

- `sheets_collaborate.share_add` — manager shares with team
- `sheets_advanced.add_protected_range` — finance locks formula rows
- `sheets_collaborate.approval_create` — finance approves changes
- `sheets_history.timeline` — shows who changed what when

**Error Scenarios**:

- Contractor can see data they shouldn't (permission not enforced)
- Approver not notified of pending changes
- Old permissions not revoked (former contractor still has access)
- Share link expiration not enforced
- Delegation not tracked (who approved what)

**LLM Intelligence Opportunities**:

- Suggest permission levels: "3 contractors need access to Q1 budget only. Recommend: 90-day share link with read-only access."
- Detect security risks: "Spreadsheet shared with 'anyone with link'. Contains salary data. Recommend: restrict to @company.com."

---

### Scenario E: Undo/Rollback Scenarios

**Setup**: Analyst accidentally deletes 200 rows of data

**Expected Behavior**:

- Undo operation recovers deleted data
- Rollback to snapshot recovers entire state
- Undo history preserved for 30+ days
- Restoration doesn't corrupt formulas

**ServalSheets Actions**:

- `sheets_history.undo` — immediate undo of last action
- `sheets_history.revert_to` — revert to specific point in time
- `sheets_history.restore_cells` — restore specific cells from past revision
- `sheets_collaborate.version_restore_snapshot` — restore from snapshot

**Error Scenarios**:

- Undo not working (user is disconnected when trying to undo)
- Snapshot too old (can't roll back more than 1 week)
- Undo creates new version (history becomes confusing)
- Formulas break after undo (dependencies corrupted)
- Multi-user undo conflict (can't undo when another user is editing)

**LLM Intelligence Opportunities**:

- Confirm destructive action: "Are you sure you want to delete 200 rows? This can be undone for 30 days, but recommend snapshot first."
- Suggest recovery strategy: "5 daily snapshots available. Latest is 2 hours old. Want to restore from then?"

---

### Scenario F: Rate Limiting & Quota Management

**Setup**: Running 50 concurrent writes to BigQuery connector

**Expected Behavior**:

- Requests queue and respect API quotas
- Partial failures handled gracefully (some succeed, some retry)
- User is informed of quota limits
- Recovery time is predictable

**ServalSheets Actions**:

- `sheets_bigquery.export_to_bigquery` — concurrent exports
- `sheets_connectors.subscribe` — auto-refresh on schedule
- `sheets_data.batch_write` — concurrent writes

**Error Scenarios**:

- API quota exceeded (403 quota error)
- Retry-After header not respected (retry too soon)
- Circuit breaker opens (too many consecutive failures)
- Timeout before quota reset (user waiting 30+ minutes)
- Partial data written (some rows succeed, some fail)

**LLM Intelligence Opportunities**:

- Suggest batching: "50 concurrent writes will exceed quota in 2 minutes. Recommend: batch 10 at a time with 1-minute delays."
- Estimate recovery: "Quota exceeded at 2:30pm. Resets at 3:00pm (30 minutes). Recommend: wait and retry at 3:05pm."

---

### Scenario G: Offline/Degraded Mode Behavior

**Setup**: Network connection intermittent, BigQuery API down

**Expected Behavior**:

- Sheets operations (read/write) work offline (cached)
- External APIs (BigQuery, Salesforce) gracefully degrade
- User is informed of what's unavailable
- Retry automatically when connection restored

**ServalSheets Actions**:

- `sheets_data.read` — read from local cache
- `sheets_bigquery.query` — fails gracefully with helpful error
- `sheets_connectors.query` — connector API unavailable

**Error Scenarios**:

- Offline mode not detected (user thinks changes are saved but they're not)
- Cache stale (user edits based on outdated data)
- Merge conflicts when reconnecting (offline changes conflict with cloud changes)
- External API failures cascaded (BigQuery down breaks dependent formulas)

**LLM Intelligence Opportunities**:

- Alert on connection loss: "Lost connection to BigQuery at 2:45pm. Using cached data from 2:30pm. Updates will sync when connection restored."
- Suggest retry strategy: "BigQuery API down (status page: 60-minute maintenance window). Recommend: retry at 3:45pm or use cached data."

---

## Error Scenario Taxonomy

### Category 1: Data Validation Errors

| Error                                                | Severity | Recovery                        | LLM Role                         |
| ---------------------------------------------------- | -------- | ------------------------------- | -------------------------------- |
| Invalid email format                                 | Medium   | Highlight, ask user to correct  | Suggest corrected format         |
| Negative quantity in inventory                       | High     | Block write, show error         | Explain why negative not allowed |
| Missing required field                               | High     | Block write, highlight cell     | Suggest default value            |
| Data type mismatch (text in number field)            | High     | Block write, show error         | Suggest correct format           |
| Date out of logical range (employee birth year 1805) | Medium   | Flag as warning, allow override | Confirm if intentional           |
| Duplicate key (two customers with same ID)           | High     | Block write, identify conflict  | Suggest merge or de-duplicate    |

### Category 2: Formula Errors

| Error                             | Severity | Recovery                           | LLM Role                           |
| --------------------------------- | -------- | ---------------------------------- | ---------------------------------- |
| #DIV/0! (division by zero)        | High     | Highlight cell, show error         | Explain cause, suggest fix         |
| #REF! (broken reference)          | High     | Identify source, show error        | Suggest corrected reference        |
| Circular reference                | High     | Block entry, prevent infinite loop | Explain dependency cycle           |
| #NAME? (unknown function)         | High     | Show error, list valid functions   | Suggest correct function name      |
| #VALUE! (wrong type in formula)   | High     | Show error                         | Explain expected type              |
| Formula references deleted column | High     | Identify broken formula            | Update reference or restore column |

### Category 3: Permission Errors

| Error                                          | Severity | Recovery                          | LLM Role                   |
| ---------------------------------------------- | -------- | --------------------------------- | -------------------------- |
| Insufficient permissions to read sheet         | High     | Show error, suggest contact owner | Identify why access needed |
| Can't modify protected range                   | High     | Show error, identify locker       | Ask owner to unprotect     |
| Sheet shared with wrong email                  | Medium   | Suggest correct email, re-share   | Confirm correct recipient  |
| Share link expired                             | High     | Generate new link                 | Suggest expiration policy  |
| User role insufficient (viewer trying to edit) | High     | Block action, show error          | Explain role requirements  |

### Category 4: API & Integration Errors

| Error                                | Severity | Recovery                     | LLM Role                        |
| ------------------------------------ | -------- | ---------------------------- | ------------------------------- |
| API authentication failed (bad key)  | High     | Show error, suggest re-auth  | Guide through re-authentication |
| API rate limit exceeded              | Medium   | Queue and retry with backoff | Estimate wait time and ETA      |
| Timeout (API slow)                   | Medium   | Retry or use cached data     | Suggest chunking data           |
| API endpoint changed                 | High     | Migrate to new endpoint      | Provide migration path          |
| Currency/locale mismatch             | Medium   | Flag and convert             | Apply correct conversion rate   |
| Timezone ambiguity (which timezone?) | Medium   | Ask user to specify          | Suggest default timezone        |

### Category 5: Concurrency & Conflict Errors

| Error                                       | Severity | Recovery                         | LLM Role                         |
| ------------------------------------------- | -------- | -------------------------------- | -------------------------------- |
| Write conflict (2 users edit same cell)     | High     | Show conflict, ask which to keep | Suggest which is more recent     |
| Row deleted while filtering                 | Medium   | Refresh filter                   | Suggest audit trail for deletion |
| Formula updated mid-dependency              | Medium   | Re-evaluate dependent cells      | Show cascade of changes          |
| Undo failed (too many changes since action) | Medium   | Revert to snapshot instead       | Suggest latest snapshot          |

### Category 6: Performance Errors

| Error                         | Severity | Recovery                   | LLM Role                              |
| ----------------------------- | -------- | -------------------------- | ------------------------------------- |
| Operation times out (>30s)    | Medium   | Cancel and chunk operation | Suggest breaking into smaller batches |
| Memory exhausted (large file) | High     | Out of memory, reduce data | Suggest sampling or pagination        |
| Formula evaluation too slow   | Medium   | Simplify formula           | Identify expensive operations         |
| Large export times out        | Medium   | Export in chunks           | Suggest staggered export times        |

---

## LLM Intelligence Opportunities

### Category 1: Data Quality & Anomaly Detection

1. **Outlier Detection**: "This customer's order size is 10x average. Typo or legitimate?"
2. **Missing Data**: "15 invoices missing customer names. Can't process. Investigate?"
3. **Duplicates**: "Found 3 accounts with name 'John Smith'. Same person or different?"
4. **Inconsistent Formats**: "Phone numbers are mixed format. Want me to standardize?"
5. **Stale Data**: "Product pricing hasn't updated in 6 months. Current?"
6. **Correlated Anomalies**: "Revenue up 30% but customer count flat. Check for one large customer?"

### Category 2: Intelligent Recommendations

1. **Formula Suggestions**: "You have Revenue - COGS columns. Want me to add Margin % formula?"
2. **Chart Suggestions**: "Time-series data detected. Recommend: line chart."
3. **Formatting Suggestions**: "Currency column detected. Should I apply $ formatting?"
4. **Aggregation Suggestions**: "200 rows grouped by Region. Want me to create summary by region?"
5. **Validation Rules**: "Phone field. Want me to add regex validation?"
6. **Pivot Suggestions**: "Sales data by customer, product, date. Useful pivot table?"

### Category 3: Proactive Insights

1. **Trend Analysis**: "Sales trend shows consistent 5% growth month-over-month. Forecast Q4?"
2. **Variance Analysis**: "Actual spend 20% below budget in Q3. Reallocate to Q4?"
3. **Bottleneck Detection**: "Approval step is slowing down process. Takes 5 days average. Why?"
4. **Early Warning**: "Inventory of Product X will run out in 8 days at current burn rate. Reorder?"
5. **Opportunity Identification**: "Channel A has 1.5x ROAS, Channel B has 3.0x. Reallocate budget?"
6. **Fairness Checks**: "Compensation gap: women earn 8% less than men in same role. Equity issue?"

### Category 4: Error Prevention & Recovery

1. **Formula Validation**: "Formula references 200 rows but only 20 rows have data. Intentional?"
2. **Dependency Tracking**: "If you rename this column, 10 other formulas will break."
3. **Circular Dependency Warning**: "Formula chain detected: A→B→C→A. Circular. Will loop infinitely."
4. **Safe Deletion Confirmation**: "About to delete 500 rows. Create snapshot first?"
5. **Timeout Prevention**: "Sorting 15K rows might timeout. Recommend: sort by most significant column first."

### Category 5: Workflow Optimization

1. **Batching Suggestions**: "50 individual writes. Recommend: batch in 10-request chunks."
2. **Caching Recommendations**: "Reading same range 5 times. Cache and reuse?"
3. **Permission Optimization**: "Sharing with 20 people. Recommend: create team and share with team instead."
4. **Schedule Optimization**: "Daily refresh at 2pm hits quota limit. Move to midnight?"
5. **Archive Suggestions**: "Data from 2022 hasn't been accessed in 1 year. Archive to cold storage?"

### Category 6: Context-Aware Assistance

1. **Session Continuity**: "Last week you analyzed Q3 budget. Want to continue with Q4?"
2. **Pattern Learning**: "You rejected suggestions to add margin % formula 3 times. Won't suggest again."
3. **Peer Comparison**: "Your forecast accuracy is 85% (above 80% team average). Good calibration."
4. **Domain-Specific Hints**: "Financial analyst role. Recommend: focus on variance analysis and scenario modeling."

---

## Wizard & Elicitation Opportunities

### 1. Sheet Creation Wizard (F1)

**When**: User calls `sheets_core.create` without a title
**Steps**:

1. "What's this spreadsheet for?" (title)
2. "Budget, Analysis, Tracking, or Other?" (category)
3. "Shared with whom?" (create with specific sharing)
4. "Propose structure?" (yes→suggest columns; no→blank)

**LLM Role**: Suggest title based on conversation, propose column names based on category

### 2. Chart Creation Wizard (sheets_visualize.chart_create)

**When**: User wants to visualize data but hasn't specified chart type
**Steps**:

1. "What metric to visualize?" (dropdown of columns)
2. "Chart type?" (show options based on data: time series→line, comparison→bar, etc.)
3. "Title and labels?" (default suggestions)

**LLM Role**: Recommend chart type based on data characteristics

### 3. Data Validation Wizard (sheets_format.set_data_validation)

**When**: User wants to add validation to column
**Steps**:

1. "What column?" (select column)
2. "Validation type?" (List, Number range, Date, Email, Regex)
3. "Allowed values?" (for List) or range (for Number/Date)
4. "Error message?" (custom or default)

**LLM Role**: Suggest validation type based on column name/values

### 4. Conditional Formatting Wizard (sheets_format.add_conditional_format_rule)

**When**: User wants conditional formatting but unclear on rules
**Steps**:

1. "What range?" (select or enter A1 ref)
2. "Condition type?" (Value greater than, Formula, Color scale, etc.)
3. "Formatting?" (color, number format, etc.)

**LLM Role**: Recommend condition based on data (red for low values, green for high)

### 5. Formula Builder Wizard (sheets_analyze.generate_formula)

**When**: User describes desired calculation but isn't sure of syntax
**Steps**:

1. "Describe the calculation" (natural language)
2. "Confirm formula?" (show generated formula)
3. "Apply to range?" (A2:A100?)

**LLM Role**: Generate formula from description

### 6. Scenario Modeling Wizard (sheets_dependencies.model_scenario)

**When**: User wants "what-if" analysis but unsure of approach
**Steps**:

1. "What if variable?" (choose which cells to change)
2. "New values?" (specify alternative values)
3. "Show impact on?" (which metrics matter)

**LLM Role**: Suggest reasonable scenarios (±10%, ±20%) based on data ranges

### 7. Access Control Wizard (sheets_collaborate.share_add)

**When**: User shares spreadsheet but doesn't specify permissions
**Steps**:

1. "Who to share with?" (email, team, or public link)
2. "Permission level?" (Viewer, Commenter, Editor)
3. "Expiration?" (permanent or time-limited)
4. "Notification?" (email them or not)

**LLM Role**: Recommend permission level based on role (CFO→Editor, Contractor→Viewer)

### 8. Commission Calculation Wizard (custom for Persona 3)

**When**: Sales ops sets up commission formula
**Steps**:

1. "Base commission rate?" (e.g., 5%)
2. "Accelerator threshold?" (e.g., 125% of quota→+10% bonus)
3. "Exclusions?" (categories that don't get commission)
4. "Clawback policy?" (e.g., if deal cancels within 12 months, commission reversed)

**LLM Role**: Suggest industry-standard rates based on deal size/category

### 9. Grading Scale Wizard (Persona 7)

**When**: Teacher sets up gradebook
**Steps**:

1. "Grade scale?" (A=90-100, B=80-89, etc., or custom)
2. "Categories and weights?" (Homework 30%, Quiz 20%, Exam 50%)
3. "Extra credit?" (allowed or not)
4. "Rounding?" (round up at 0.5 or strict cutoff)

**LLM Role**: Suggest standard grade scale and weights

---

## Summary & Key Insights

### Most Common Tool Needs

1. **sheets_data**: Read/write/merge data (all 8 personas)
2. **sheets_composite**: Import/export/consolidate (6/8 personas)
3. **sheets_analyze**: Detect patterns, anomalies (7/8 personas)
4. **sheets_format**: Conditional formatting, validation (7/8 personas)
5. **sheets_dimensions**: Sort, filter, freeze (7/8 personas)
6. **sheets_dependencies**: Impact analysis, scenario modeling (4/8 personas)
7. **sheets_visualize**: Charts and dashboards (7/8 personas)
8. **sheets_collaborate**: Sharing, approvals, comments (7/8 personas)

### Most Critical Error Scenarios

1. Data validation (missing required fields, duplicates)
2. Formula errors (circular refs, broken refs)
3. Concurrent editing conflicts
4. Permission errors
5. API rate limiting
6. Performance timeouts on large datasets

### Most Impactful LLM Intelligence

1. Anomaly detection (outliers, missing data, duplicates)
2. Recommendation (formulas, charts, formatting)
3. Trend analysis (variance, forecasting)
4. Error prevention (circular refs, broken refs, overallocation)
5. Workflow optimization (batching, caching, scheduling)

### Cross-Persona Requirements

- **Real-time collaboration** (multiple users editing same sheet)
- **Data quality validation** (both automated and user-triggered)
- **Audit trail & change history** (who did what, when)
- **Permission management** (roles, time-limited access)
- **Snapshot/undo capability** (recovery from mistakes)
- **External integrations** (BigQuery, Salesforce, APIs)
- **Large dataset handling** (10K+ rows, 100+ columns)
- **Reporting & dashboards** (executive summaries)

---

## End of Research Document

This comprehensive workflow research document is complete. It covers:

- **50+ real-world workflows** across 8 distinct user personas
- **400+ specific tool/action usage patterns**
- **100+ error scenarios** with recovery strategies
- **60+ LLM intelligence opportunities**
- **9 wizard/elicitation templates**
- **7 cross-cutting test scenarios**

All information is research-only with no code changes. This can serve as:

1. **Test case design** (each workflow → test suite)
2. **Documentation** (exemplars for users)
3. **Feature prioritization** (which tools matter most)
4. **Error handling design** (what can go wrong)
5. **LLM prompt engineering** (context for suggestions)
6. **Wizard/elicitation design** (when to ask users for input)
