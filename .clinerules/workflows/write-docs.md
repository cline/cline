# Write Docs Workflow

A structured 4-step process for creating and updating Cline documentation. This workflow guides you through research, scoping, outlining, and writing documentation that follows Cline's established patterns.

## Before You Begin

Internalize the writing guidelines in `.clinerules/workflows/writing-documentation.md`. Key principles:
- Write for action, not just understanding
- Show real examples, not toy demos
- Cut the corporate speak
- Never use em dashes or emojis
- Brevity is the soul of wit

---

## Step 1: Research

Silently investigate the existing documentation structure and patterns. Don't narrate this phase.

### Commands to Run

```bash
# Understand the docs structure
cat docs/docs.json | head -200

# Find related documentation
find docs -name "*.mdx" | head -50

# Search for related content
grep -r "TOPIC_KEYWORD" docs/ --include="*.mdx" -l
```

### Questions to Answer

1. What related docs already exist?
2. Where should this doc live in the navigation?
3. What Mintlify components do similar docs use?
4. Are there existing docs to cross-link?

### If this doc describes settings or UI

Do not guess labels or options. Verify them in the codebase:

- UI labels and menu options typically live in `webview-ui/src`.
- Saved settings types and defaults typically live in `src/shared`.

Quick checks:

```bash
# Find the UI constants that define labels
grep -r "label:" webview-ui/src --include="*.ts" --include="*.tsx" | head -50

# Verify the setting exists in the shared settings type
grep -r "interface .*Settings" src/shared --include="*.ts" -n
```

Also check for removed features and legacy fields:

- If you see mentions of favorites, stars, or max requests, assume it may be legacy. Confirm before documenting.

### Files to Examine

Read 2-3 similar docs to understand the tone and structure:
- For features: `docs/features/drag-and-drop.mdx`, `docs/features/checkpoints.mdx`
- For slash commands: `docs/features/slash-commands/deep-planning.mdx`
- For guides: `docs/getting-started/your-first-project.mdx`
- For reference: `docs/exploring-clines-tools/cline-tools-guide.mdx`

---

## Step 2: Scope

Ask clarifying questions to understand the documentation requirements.

### Questions to Ask the User

```xml
<ask_followup_question>
<question>I need to understand the scope for this documentation:

1. **Target audience**: New users, experienced developers, or contributors?
2. **Doc type**: Feature explanation, how-to guide, reference, or tutorial?
3. **Key use cases**: What problems does this solve?
4. **Prerequisites**: What should readers know first?
5. **Editor applicability**: Does this apply to all editors (VS Code, JetBrains, CLI) or specific ones?

Please share any additional context about what you want covered.</question>
</ask_followup_question>
```

### Doc Type Decision Tree

Choose the appropriate template:

| If the doc... | Use Template |
|--------------|-------------|
| Explains what a feature does | Feature Doc |
| Shows how to accomplish a task | How-To Guide |
| Provides technical specifications | Reference Doc |
| Walks through a complete project | Tutorial |

### Greenfield vs Brownfield

Decide whether you are documenting an existing feature or a feature that is still being designed.

```xml
<ask_followup_question>
<question>Is this documentation for a feature that already exists (brownfield) or a feature that’s still being designed/implemented (greenfield)?</question>
<options>["Brownfield (already exists)", "Greenfield (new / in progress)"]</options>
</ask_followup_question>
```

#### Brownfield (already exists)

Default assumption: the code and UI are the source of truth.

- Verify UI labels and menu options in `webview-ui/src`.
- Verify behavior in `src/core` handlers/types.
- Remove references to legacy or removed features.
- If the behavior is model-dependent or heuristic, write “examples, not guarantees.”

Ask follow-ups only when the behavior is unclear, inconsistent, or the user has a specific documentation goal that changes what you include.

#### Greenfield (new / in progress)

Default assumption: the code may be incomplete or changing, so you need design context.

Ask for any available:
- PRD/spec/design doc (even rough)
- UI mocks or screenshots (if UI-facing)
- Intended user workflow (happy path)
- Non-goals and constraints
- Safety/security requirements
- What is stable vs likely to change before release
- Canonical source(s) to reference (issue/PR/spec paths)

Rule: If key design context is missing, stop after producing a Doc Brief plus a list of missing inputs. Do not guess.

### Doc Brief (Required Output)

Before outlining, produce a short Doc Brief and confirm it with the user. If anything is unclear, ask follow-ups now, not later.

Add these fields when relevant:

- If this doc describes UI/settings: include the file path where the UI labels live (canonical source).
- If the behavior is heuristic/model-dependent: explicitly mark it as “examples, not guarantees.”

Doc Brief format:

```markdown
## Doc Brief

- Goal (one sentence):
- Audience:
- Prerequisites:
- Doc type:
- Placement (docs.json group + page path):
- Editor applicability: [All editors / VS Code only / JetBrains only / CLI only / note differences]
- Canonical source(s):
- Key use cases (bulleted):
- Non-goals (bulleted):
- Required examples/assets:
- Assumptions (bulleted):
```

### Editor Applicability

Prioritize documentation that applies to all editors (VS Code, JetBrains, CLI). When writing:

- Lead with behavior that's consistent across all editors
- Call out editor-specific differences in a dedicated subsection or callout, not scattered throughout
- If a feature is only available in one editor, state this clearly in the intro

Confirmation prompt:

```xml
<ask_followup_question>
<question>Here is the Doc Brief I'm planning to write against:

[PASTE DOC BRIEF]

Is this accurate before I outline and draft the doc?</question>
<options>["Yes, proceed", "No, revise the brief", "I have more context to add"]</options>
</ask_followup_question>
```

---

## Step 3: Outline

Create a structured outline based on the selected template.

### Feature Doc Template

```markdown
---
title: "Feature Name"
sidebarTitle: "Feature Name"
---

[One sentence explaining what this feature does]

<Frame>
  <img src="..." alt="Feature in action" />
</Frame>

[1-2 paragraphs explaining the feature in plain terms]

## How It Works

Must add at least 2 mechanics that are not stated in the intro. Examples:
- How permissions are evaluated (per tool call)
- Dependencies between toggles (base + sub-toggle)
- What is deterministic vs heuristic/model-dependent
- Overrides (YOLO mode)
- Notification behavior

If you can’t add new mechanics, delete this section.

## Using [Feature Name]

[Show how to access and use it]

### [Subfeature or Option 1]

[Details with examples]

### [Subfeature or Option 2]

[Details with examples]

## When to use it

[Concrete situations where this feature is helpful. Keep it short and practical.]

<Note>
  [Important caveat or limitation]
</Note>
```

### How-To Guide Template

```markdown
---
title: "How to [Accomplish Task]"
sidebarTitle: "[Short Title]"
description: "[One sentence describing what the reader will learn]"
---

[Brief intro - what problem this solves]

## Prerequisites

[What the reader needs before starting - keep it short]

## Steps

<Steps>
  <Step title="[Action 1]">
    [Clear instructions with code examples if needed]
  </Step>
  <Step title="[Action 2]">
    [Next step with visuals if helpful]
  </Step>
  <Step title="[Action 3]">
    [Continue until task is complete]
  </Step>
</Steps>

## Troubleshooting

[Common issues and fixes - use bullet points]

## Next Steps

[Link to related docs]
```

### Reference Doc Template

```markdown
---
title: "[Component/API] Reference"
sidebarTitle: "[Short Title]"
description: "[What this reference covers]"
---

[Brief description of what this reference documents]

## Overview

[High-level explanation of the component/API]

## [Section 1]

### [Item 1]

| Property | Type | Description |
|----------|------|-------------|
| `name` | string | What it does |

### [Item 2]

[Continue for each item]

## Examples

[Show practical usage]

## Related

[Cross-links to relevant docs]
```

### Tutorial Template

```markdown
---
title: "[Build/Create X] Tutorial"
sidebarTitle: "[Short Title]"
description: "[What the reader will build]"
---

In this tutorial, you'll build [specific outcome]. By the end, you'll have [tangible result].

<Frame>
  <img src="..." alt="Final result preview" />
</Frame>

## What You'll Learn

- [Skill 1]
- [Skill 2]
- [Skill 3]

## Prerequisites

[Required setup - link to other docs where possible]

## Part 1: [First Major Section]

[Detailed walkthrough with code blocks and explanations]

## Part 2: [Second Major Section]

[Continue building]

## Part 3: [Final Section]

[Complete the project]

## Summary

[Recap what was built and learned]

## Next Steps

[Where to go from here]
```

---

## Step 4: Write

Generate the documentation following these guidelines.

### Output Requirements (Per Step)

At minimum, produce these artifacts:

- Step 2 output: Confirmed Doc Brief
- Step 3 output: Outline with exact headings and planned Mintlify components
- Step 4 output: Final MDX (file path + content) and any required `docs/docs.json` update

### Avoid Duplication (Canonical Sources)

Avoid docs that rot. Prefer a canonical source and link to it.

- If a workflow file is the source of truth, do not paste the entire workflow into public docs. Summarize and link to the repo path (example: `.clinerules/workflows/write-docs.md`).
- If behavior is defined in code, reference the code path and explain the behavior briefly. Don't try to re-document every edge case.
- Every doc should identify its canonical source(s) in the Doc Brief so future updates are obvious.

### Frontmatter Requirements

Every doc needs this YAML frontmatter:

```yaml
---
title: "Full Page Title"
sidebarTitle: "Shorter Nav Title"  # optional, for long titles
description: "One sentence for SEO and previews"  # optional but recommended
---
```

### Mintlify Components

Use components appropriately:

**Frame** - Wrap all images. Use images sparingly:
```jsx
<Frame>
  <img src="https://storage.googleapis.com/cline_public_images/docs/assets/filename.png" alt="Descriptive text" />
</Frame>
```

**When to use images:**
- GIFs showing a specific interaction that's hard to describe (e.g., drag-and-drop, mode switching)
- Screenshots of complex UI that would take many words to describe

**When NOT to use images:**
- Static UI that can be described in a sentence ("Click the gear icon in the Cline panel")
- Multiple screenshots showing the same UI with minor variations
- Images that duplicate what the text already explains
- Decorative images that don't add information

Default to text. If you can describe it in one sentence, skip the image. Tables and bullet lists are usually clearer than annotated screenshots.

**Video References** - Use Tip callouts with links, not embedded players. Keep docs text-focused:
```jsx
<Tip>
  **New to [topic]?** Watch [Video Title](https://youtu.be/VIDEO_ID) to see it in action.
</Tip>
```

**Note/Tip/Warning** - For callouts:
```jsx
<Note>Important information the reader needs.</Note>
<Tip>Helpful suggestion that improves the experience.</Tip>
<Warning>Something that could cause problems if ignored.</Warning>
```

**Steps** - For sequential procedures:
```jsx
<Steps>
  <Step title="First Step">Content here</Step>
  <Step title="Second Step">Content here</Step>
</Steps>
```

**Card/CardGroup** - For navigation links:
```jsx
<CardGroup cols={2}>
  <Card title="Feature Name" icon="icon-name" href="/path/to/doc">
    Brief description of what this links to.
  </Card>
</CardGroup>
```

### Style Checklist

Before finishing, verify:

- [ ] Active voice throughout ("Cline creates" not "files are created by Cline")
- [ ] Sentences under 25 words on average
- [ ] No em dashes or emojis
- [ ] Real examples, not abstract descriptions
- [ ] Cross-links to related documentation
- [ ] Proper heading hierarchy (h2 → h3 → h4, never skip)
- [ ] Code blocks have language specified
- [ ] Images have descriptive alt text (and are used sparingly - prefer text)
- [ ] No removed feature references (stars/favorites/max requests) unless you confirmed they exist today
- [ ] If describing UI/settings, labels match current UI constants
- [ ] If behavior is heuristic/model-dependent, doc says “examples, not guarantees”

### When documenting a list of settings

If you’re documenting 5+ toggles or options, default to a table-first layout:
- Put the list in a compact table for scanning.
- Put 1–3 callouts below the table for the important gotchas.

### Step 4.5: QA Pass (Required)

Do a mechanical quality pass before you call it done:

- Banned words: search and remove "utilize", "in order to", and "This document".
- Scan for em dashes and remove them.
- Heading sanity: no skipping heading levels.
- Link sanity: make sure every `/...` link resolves to a real doc page.
- Scan test: if you read only headings and the first sentence under each heading, does it still make sense?

Minimum viable vs deep docs:

- If the feature is changing or unstable, keep it minimal: what it is, how to use it, one real example.
- If the feature is stable, include internals, edge cases, and troubleshooting.

### Cross-Linking (Required Pass)

After writing, do a quick cross-link pass:

- Add at least **2 outbound links** to relevant docs so readers know where to go next.
- Identify 1-2 **inbound link candidates** (existing pages that should link to this new page). If you're editing those pages in this task, add the links.

Common pages to reference:
- `/features/plan-and-act` - Plan/Act mode
- `/features/checkpoints` - Checkpoints and versioning
- `/features/auto-approve` - Auto-approve settings
- `/features/cline-rules` - Custom rules
- `/features/at-mentions/overview` - @ mentions

---

## Final Steps

1. **Preview locally**: Run `cd docs && npm run dev` to preview changes
2. **Check navigation**: Ensure `docs/docs.json` is updated if adding a new page
3. **Validate links**: Check all cross-links resolve correctly
4. **Read aloud**: Does it sound natural? Would a dev find this helpful?

---

## Quick Reference

### Good Writing Patterns

```markdown
# Good: Direct and actionable
Switch to bash in Cline Settings → Terminal → Default Terminal Profile.

# Bad: Wordy and passive
The default terminal profile setting can be found in the Cline settings 
menu, where users are able to change it to bash if they so desire.
```

```markdown
# Good: Real example with "I" voice
I use checkpoints whenever I'm experimenting with a new approach. 
If things go wrong, I can restore to a known good state in seconds.

# Bad: Abstract and impersonal
Checkpoints can be utilized by users who wish to experiment with 
different approaches to their code modifications.
```

### Common Mistakes to Avoid

- Starting with "This document explains..." (just explain it)
- Using "utilize" instead of "use"
- Writing walls of text without headers or lists
- Explaining obvious things
- Using the **Bold Text**: description pattern excessively
- Forgetting to show where features are located in the UI
