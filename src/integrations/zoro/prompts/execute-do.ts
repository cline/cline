import { EnforcementResponse } from "../types"

export function getExecuteDoPrompt(
	verificationResult: EnforcementResponse,
	stepDescription: string,
	substepDescription?: string,
): string {
	const violatedRules = verificationResult.rules_analysis?.filter((r) => !r.followed) || []
	const passedRules = verificationResult.rules_analysis?.filter((r) => r.followed) || []
	const filesSummary = verificationResult.files_summary || []

	let prompt = `# Task: Fix Gaps in Implementation

## Current Status: ${verificationResult.verdict}

${stepDescription ? `## Step Description\n${stepDescription}\n` : ""}
${substepDescription ? `## Substep Description\n${substepDescription}\n` : ""}

## Overview
${verificationResult.overview}

`

	if (violatedRules.length > 0) {
		prompt += `## ⚠️ RULES THAT NEED TO BE FIXED (${violatedRules.length})

**Your task is to fix ONLY these violated rules:**

${violatedRules
	.map(
		(rule, i) => `
### ${i + 1}. ${rule.rule_text}
- **Rule ID**: ${rule.rule_id}
- **Status**: ❌ NOT FOLLOWED
- **Evidence**: ${rule.evidence || "No evidence provided"}
`,
	)
	.join("\n")}

`
	}

	if (passedRules.length > 0) {
		prompt += `## ✅ RULES ALREADY PASSING - DO NOT TOUCH (${passedRules.length})

**These rules are already satisfied. Do NOT modify code related to these:**

${passedRules.map((rule, i) => `${i + 1}. ${rule.rule_text} (${rule.rule_id})`).join("\n")}

`
	}

	if (filesSummary.length > 0) {
		prompt += `## 📁 Files That Need Changes

${filesSummary
	.map(
		(file, i) => `
### ${i + 1}. ${file.path}
- **Lines**: ${file.lines_changed || "unknown"}
- **What needs to change**: ${file.changes}
- **Why**: ${file.impact}
`,
	)
	.join("\n")}

`
	}

	prompt += `
## 🐍 CRITICAL: Python Import Guidelines

When writing or modifying Python files in this workspace:

**USE ABSOLUTE IMPORTS FROM WORKSPACE ROOT:**

✅ **CORRECT** - Always use full module path:
\`\`\`python
from backend.schemas import ColorScheme
from backend.api.routes import helper_function
from backend.storage import load_data, save_data
\`\`\`

❌ **WRONG** - Do NOT use relative imports or partial paths:
\`\`\`python
from schemas import ColorScheme          # ❌ Missing 'backend.'
from api.routes import helper_function   # ❌ Missing 'backend.'
from storage import load_data            # ❌ Missing 'backend.'
from .routes import helper_function      # ❌ Relative import
\`\`\`

**WHY THIS MATTERS:**
- Tests run from workspace root with PYTHONPATH set to workspace directory
- All imports must be resolvable from that root
- Partial paths will cause \`ModuleNotFoundError\`

**APPLY TO:**
- All import statements in implementation files
- When creating new modules in backend/
- When modifying existing code

## Instructions

1. **Read the violated rules carefully** - understand what is missing or incorrect
2. **Use tools to investigate** - read relevant files to understand current state
3. **Make targeted changes** - fix ONLY what violates the rules above
4. **DO NOT touch passing rules** - preserve code that already works
5. **Use write_to_file or replace_in_file** - make precise changes
6. **Verify your changes** - ensure the violated rules will now pass

## Available Tools
- read_file: Read any file in the workspace
- write_to_file: Create or overwrite a file
- replace_in_file: Search and replace within a file
- execute_command: Run shell commands
- search_files: Find files matching a pattern

## Goal
After you complete your changes, the violated rules should pass verification. Be surgical - only fix what's broken.
`

	return prompt
}
