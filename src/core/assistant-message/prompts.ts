import { Phase, Subtask } from "./phase-tracker"

export const PROMPTS = {
	PLANNING: `**Step 1:** First, analyze the user's request and produce your \`assistantMessage\` using the following tags:
1. \`<thinking>…</thinking>\` - Explain your overall approach and reasoning
2. \`<execute_command>…</execute_command>\` - Any commands to be executed  
3. \`<write_to_file>…</write_to_file>\` - File creation or modification actions
4. \`<attempt_completion>…</attempt_completion>\` - Results or completion attempts
**Step 2:** Organize your implementation into distinct phases. For each phase:
1. Identify a clear, independent unit of work with a specific goal
2. Include only related operations that should be completed together
3. Ensure each phase has a clear starting and completion point
4. Consider logical dependencies (e.g., files need to be created before used)
**Step 3:** Return your implementation in the following EXACT format:
1. First, provide your complete \`assistantMessage\` with all required tags
2. Then, add a divider: \`---\n## Phase Plan\`
3. Finally, list your phases using this specific format:
\`\`\`
Phase 1: [Phase Name/Description]
- Description: [Brief explanation of what this phase accomplishes]
- Paths: [List of relevant file paths, one per line]
- Subtasks:
  * [Specific task 1]
  * [Specific task 2]
Phase 2: [Phase Name/Description]
- Description: [Brief explanation of what this phase accomplishes]
- Paths: [List of relevant file paths, one per line]
- Subtasks:
  * [Specific task 1]
  * [Specific task 2]
\`\`\`
**Alternatively, you may provide phases in this structured JSON format:**
\`\`\`json
{
  "phases": [
    {
      "index": 1,
      "phase_prompt": "Phase Name/Description",
      "description": "Brief explanation of what this phase accomplishes",
      "paths": ["file1.js", "file2.js"],
      "subtasks": [
        {"description": "Specific task 1", "type": "write_to_file"},
        {"description": "Specific task 2", "type": "execute_command"}
      ]
    },
    {
      "index": 2,
      "phase_prompt": "Next Phase Name/Description",
      "description": "Brief explanation of what this phase accomplishes",
      "paths": ["file3.js"],
      "subtasks": [
        {"description": "Another specific task", "type": "write_to_file"}
      ]
    }
  ]
}
\`\`\`
For example (text format):
\`\`\`
Phase 1: File Creation Phase
- Description: Creating necessary source files and directories
- Paths: 
  main.py
  config.json
- Subtasks:
  * Create main.py with application entry point
  * Create config.json with initial configuration
   
Phase 2: Database Setup Phase
- Description: Setting up database schema and initial data
- Paths:
  schema.sql
- Subtasks:
  * Create schema.sql with database structure
  * Initialize database with schema
\`\`\`
Always add a clear divider between your assistantMessage and the Phase Plan. Be specific and structured in listing your phases to ensure easy parsing.`,
} as const

/**
 * Build the system / user prompt that will be fed to the LLM for one *execution*
 * phase ( i.e. **after** the planning phase has produced the full roadmap ).
 *
 * @param phase          The Phase record returned by PhaseTracker.currentPhase
 * @param total          Total number of phases in the roadmap
 * @param originalPrompt The very first user request – shown verbatim for context
 */
export function buildPhasePrompt(phase: Phase, total: number, originalPrompt: string): string {
	// Helper: pretty-print the path list (can be empty)
	const pathsSection = phase.paths?.length > 0 ? phase.paths?.join("\n") : "(no specific files yet)"

	// Helper: numbered sub-tasks (guaranteed at least one – but be defensive)
	const subtasksSection = phase.subtasks.length
		? phase.subtasks.map((st: Subtask, i: number) => `${i + 1}. ${st.description.trim()}`).join("\n")
		: "1. (no explicit sub-tasks – use your best judgement)"

	// Final prompt -------------------------------------------------------------
	return `### Phase ${phase.index} / ${total - 1}  –  ${phase.phase_prompt} // except planning phase in total
You are resuming a multi-phase task.  
**Overall user goal** (for reference, do *not* re-plan):
────────────────────────────────────────  
${originalPrompt.trim()}  
────────────────────────────────────────  
## Objective of this phase
Complete every sub-task listed below **and nothing else**.
## Relevant paths / artifacts
${pathsSection}
## Sub-tasks to carry out in this phase
${subtasksSection}
---
### Tool-use rules for *execution* phases
1. **Do not** create new high-level phases or plans.  
2. Use the built-in tools (\`<write_to_file>\`, \`<execute_command>\`, …) to accomplish the sub-tasks.  
3. After each tool call, wait for the tool result before issuing another call.  
4. When **all** listed sub-tasks are finished, wrap up with  
\`\`\`
<attempt_completion>
{concise summary of what was done and where the outputs are}
</attempt_completion>
\`\`\`  
If you realise a prerequisite is missing, briefly explain it inside \`<thinking>\` **before** taking action.  
Only proceed when you are confident the current phase can be completed.
Begin now.`
}
