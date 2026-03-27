---
name: prioritization-frameworks
description: "Reference guide to 9 prioritization frameworks with formulas, when-to-use guidance, and templates — RICE, ICE, Kano, MoSCoW, Opportunity Score, and more. Use when selecting a prioritization method, comparing frameworks like RICE vs ICE, or learning how different prioritization approaches work."
---

## Prioritization Frameworks Reference

A reference guide to help you select and apply the right prioritization framework for your context.

### Core Principle

Never allow customers to design solutions. Prioritize **problems (opportunities)**, not features.

### Opportunity Score (Dan Olsen, *The Lean Product Playbook*)

The recommended framework for prioritizing customer problems.

Survey customers on **Importance** and **Satisfaction** for each need (normalize to 0–1 scale).

Three related formulas:
- **Current value** = Importance × Satisfaction
- **Opportunity Score** = Importance × (1 − Satisfaction)
- **Customer value created** = Importance × (S2 − S1), where S1 = satisfaction before, S2 = satisfaction after

High Importance + low Satisfaction = highest Opportunity Score = best opportunities. Plot on an Importance vs Satisfaction chart — upper-left quadrant is the sweet spot. Prioritizes customer problems, not solutions.

### ICE Framework

Useful for prioritizing initiatives and ideas. Considers not only value but also risk and economic factors.

- **I** (Impact) = Opportunity Score × Number of Customers affected
- **C** (Confidence) = How confident are we? (1-10). Accounts for risk.
- **E** (Ease) = How easy is it to implement? (1-10). Accounts for economic factors.

**Score** = I × C × E. Higher = prioritize first.

### RICE Framework

Splits ICE's Impact into two separate factors. Useful for larger teams that need more granularity.

- **R** (Reach) = Number of customers affected
- **I** (Impact) = Opportunity Score (value per customer)
- **C** (Confidence) = How confident are we? (0-100%)
- **E** (Effort) = How much effort to implement? (person-months)

**Score** = (R × I × C) / E

### 9 Frameworks Overview

| Framework | Best For | Key Insight |
|-----------|----------|-------------|
| Eisenhower Matrix | Personal tasks | Urgent vs Important — for individual PM task management |
| Impact vs Effort | Tasks/initiatives | Simple 2×2 — quick triage, not rigorous for strategic decisions |
| Risk vs Reward | Initiatives | Like Impact vs Effort but accounts for uncertainty |
| **Opportunity Score** | Customer problems | **Recommended.** Importance × (1 − Satisfaction). Normalize to 0–1. |
| Kano Model | Understanding expectations | Must-be, Performance, Attractive, Indifferent, Reverse. For understanding, not prioritizing. |
| Weighted Decision Matrix | Multi-factor decisions | Assign weights to criteria, score each option. Useful for stakeholder buy-in. |
| **ICE** | Ideas/initiatives | Impact × Confidence × Ease. Recommended for quick prioritization. |
| **RICE** | Ideas at scale | (Reach × Impact × Confidence) / Effort. Adds Reach to ICE. |
| MoSCoW | Requirements | Must/Should/Could/Won't. Caution: project management origin. |

### Templates

- [Opportunity Score intro (PDF)](https://drive.google.com/file/d/1ENbYPmk1i1AKO7UnfyTuULL5GucTVufW/view)
- [Importance vs Satisfaction Template — Dan Olsen (Google Slides)](https://docs.google.com/presentation/d/1jg-LuF_3QHsf6f1nE1f98i4C0aulnRNMOO1jftgti8M/edit#slide=id.g796641d975_0_3)
- [ICE Template (Google Sheets)](https://docs.google.com/spreadsheets/d/1LUfnsPolhZgm7X2oij-7EUe0CJT-Dwr-/edit?usp=share_link&ouid=111307342557889008106&rtpof=true&sd=true)
- [RICE Template (Google Sheets)](https://docs.google.com/spreadsheets/d/1S-6QpyOz5MCrV7B67LUWdZkAzn38Eahv/edit?usp=sharing&ouid=111307342557889008106&rtpof=true&sd=true)

---

### Further Reading

- [The Product Management Frameworks Compendium + Templates](https://www.productcompass.pm/p/the-product-frameworks-compendium)
- [Kano Model: How to Delight Your Customers Without Becoming a Feature Factory](https://www.productcompass.pm/p/kano-model-how-to-delight-your-customers)
- [Continuous Product Discovery Masterclass (CPDM)](https://www.productcompass.pm/p/cpdm) (video course)
