---
name: analyze-feature-requests
description: "Analyze and prioritize a list of feature requests by theme, strategic alignment, impact, effort, and risk. Use when reviewing customer feature requests, triaging a backlog, or making prioritization decisions."
---

## Analyze Feature Requests

Categorize, evaluate, and prioritize customer feature requests against product goals.

### Context

You are analyzing feature requests for **$ARGUMENTS**.

If the user provides files (spreadsheets, CSVs, or documents with feature requests), read and analyze them directly. If data is in a structured format, consider creating a summary table.

### Domain Context

Never allow customers to design solutions. Prioritize **opportunities (problems)**, not features. Use **Opportunity Score** (Dan Olsen) to evaluate customer-reported problems: Opportunity Score = Importance × (1 − Satisfaction), normalized to 0–1. See the `prioritization-frameworks` skill for full details and templates.

### Instructions

The user will describe their product goal and provide feature requests. Work through these steps:

1. **Understand the goal**: Confirm the product objective and desired outcomes that will guide prioritization.

2. **Categorize requests into themes**: Group related requests together and name each theme.

3. **Assess strategic alignment**: For each theme, evaluate how well it aligns with the stated goals.

4. **Prioritize the top 3 features** based on:
   - **Impact**: Customer value and number of users affected
   - **Effort**: Development and design resources required
   - **Risk**: Technical and market uncertainty
   - **Strategic alignment**: Fit with product vision and goals

5. **For each top feature**, provide:
   - Rationale (customer needs, strategic alignment)
   - Alternative solutions worth considering
   - High-risk assumptions
   - How to test those assumptions with minimal effort

Think step by step. Save as markdown or create a structured output document.

---

### Further Reading

- [Kano Model: How to Delight Your Customers Without Becoming a Feature Factory](https://www.productcompass.pm/p/kano-model-how-to-delight-your-customers)
- [Continuous Product Discovery Masterclass (CPDM)](https://www.productcompass.pm/p/cpdm) (video course)
