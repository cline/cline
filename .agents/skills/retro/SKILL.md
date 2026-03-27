---
name: retro
description: "Facilitate a structured sprint retrospective — what went well, what didn't, and prioritized action items with owners and deadlines. Use when running a retrospective, reflecting on a sprint, creating action items from team feedback, or learning how to run effective retros."
---

## Sprint Retrospective Facilitator

Run a structured retrospective that surfaces insights and produces actionable improvements.

### Context

You are facilitating a retrospective for **$ARGUMENTS**.

If the user provides files (sprint data, velocity charts, team feedback, or previous retro notes), read them first.

### Instructions

1. **Choose a retro format** based on context (or let the user pick):

   **Format A — Start / Stop / Continue**:
   - **Start**: What should we begin doing?
   - **Stop**: What should we stop doing?
   - **Continue**: What's working well that we should keep?

   **Format B — 4Ls (Liked / Learned / Lacked / Longed For)**:
   - **Liked**: What did the team enjoy?
   - **Learned**: What new knowledge was gained?
   - **Lacked**: What was missing?
   - **Longed For**: What do we wish we had?

   **Format C — Sailboat**:
   - **Wind (propels us)**: What's driving us forward?
   - **Anchor (holds us back)**: What's slowing us down?
   - **Rocks (risks)**: What dangers lie ahead?
   - **Island (goal)**: Where are we trying to get to?

2. **If the user provides raw feedback** (e.g., sticky notes, survey responses, Slack messages):
   - Group similar items into themes
   - Identify the most frequently mentioned topics
   - Note sentiment patterns (frustration, energy, confusion)

3. **Analyze the sprint performance**:
   - Sprint goal: achieved or not?
   - Velocity vs. commitment (over-committed? under-committed?)
   - Blockers encountered and how they were resolved
   - Collaboration patterns (what worked, what didn't)

4. **Generate prioritized action items**:

   | Priority | Action Item | Owner | Deadline | Success Metric |
   |---|---|---|---|---|
   | 1 | [Specific, actionable improvement] | [Name/Role] | [Date] | [How we'll know it worked] |

   - Limit to 2-3 action items (more won't get done)
   - Each must be specific, assignable, and measurable
   - Reference previous retro actions if available — were they completed?

5. **Create the retro summary**:
   ```
   ## Sprint [X] Retrospective — [Date]

   ### Sprint Performance
   - Goal: [Achieved / Partially / Missed]
   - Committed: [X pts] | Completed: [Y pts]

   ### Key Themes
   1. [Theme] — [summary]

   ### Action Items
   1. [Action] — [Owner] — [By date]

   ### Carry-over from Last Retro
   - [Previous action] — [Status: Done / In Progress / Not Started]
   ```

Save as markdown. Keep the tone constructive — the goal is improvement, not blame.
