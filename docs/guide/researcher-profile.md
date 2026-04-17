---
description: AI-Hydro ResearcherProfile: a persistent researcher persona that learns your expertise, preferred models, and research focus across sessions.
---

# Researcher Profile

The `ResearcherProfile` is a persistent record of who you are as a researcher — your expertise, preferred models, active projects, and domain focus. It is built up from agent-researcher interactions over time and injected into every conversation automatically.

---

## What It Stores

```json title="~/.aihydro/researcher.json"
{
  "name": "Mohammad Galib",
  "institution": "Purdue University",
  "role": "PhD Researcher",
  "domain": "Computational Hydrology",
  "expertise": ["watershed modelling", "differentiable hydrology", "CAMELS benchmark"],
  "tools_familiarity": {
    "HBV-light": "advanced",
    "NeuralHydrology": "intermediate",
    "PyTorch": "intermediate"
  },
  "preferred_models": ["HBV-light", "LSTM"],
  "research_focus": "Investigating the role of geology in controlling baseflow generation across CAMELS-US catchments.",
  "active_project": "New England Basins",
  "communication_style": "concise, technical",
  "observations": [
    "Prefers NSE and KGE together rather than NSE alone for model evaluation.",
    "Tends to work with 20-year streamflow records for signature extraction.",
    "Interested in spatial patterns more than single-basin deep dives."
  ]
}
```

---

## How It's Built

The profile is **not filled in manually** (though you can). It accumulates automatically:

- When you correct the agent, it logs the observation
- When you consistently use certain tools or parameters, it notes the pattern
- When you start a project or focus on a domain, it updates your active context

The agent calls `log_researcher_observation` silently when it learns something meaningful about your preferences.

---

## How It's Used

At the start of every conversation, the agent calls `get_researcher_profile()` and uses the result to:

- **Skip beginner explanations** if your expertise is advanced
- **Default to your preferred model** when you say "calibrate a model" without specifying which
- **Use your preferred metrics** when reporting results
- **Reference your active project** when starting work without explicit context
- **Tailor the communication style** — concise and technical vs exploratory and explanatory

This is the same idea as the memory features in Claude.ai and ChatGPT, but domain-specific to computational hydrology.

---

## Managing Your Profile

### View your profile

```
Show me my researcher profile.
```

### Update a field

```
Update my research focus to: investigating the role of snow in modulating
streamflow seasonality across the Pacific Northwest.
```

```
Set my active project to "Pacific Northwest Basins".
```

### Add to expertise

```
Add "snow hydrology" to my expertise areas.
```

### Reset observations

```
Clear my researcher observations — I want a fresh start.
```

---

## Profile in research.md

The profile is also appended to `.aihydrorules/research.md` in your workspace on every session save — so even if an agent doesn't call `get_researcher_profile`, the persona context is injected automatically via the rules file.

```markdown title=".aihydrorules/research.md (excerpt)"
## Researcher Profile
- **Name:** Mohammad Galib
- **Role:** PhD Researcher — Purdue University
- **Domain:** Computational Hydrology
- **Expertise:** watershed modelling, differentiable hydrology, CAMELS benchmark
- **Active Project:** New England Basins
- **Preferred Models:** HBV-light, LSTM
- **Communication style:** concise, technical
```
