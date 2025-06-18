import { Phase, Subtask } from "./phase-tracker"

/**
 * Build the system / user prompt that will be fed to the LLM for one *execution*
 * phase ( i.e. **after** the planning phase has produced the full roadmap ).
 *
 * @param phase          The Phase record returned by PhaseTracker.currentPhase
 * @param total          Total number of phases in the roadmap
 * @param projectOverview The very first user request – shown verbatim for context
 */
export function buildPhasePrompt(phase: Phase, total: number, projectOverview: string): string {
	// Helper: pretty-print the path list (can be empty)
	const pathsSection =
		phase.paths && phase.paths?.length > 0
			? phase.paths.map((path) => `<path>${path}</path>`).join("\n")
			: "<path>no specific files identified yet</path>"

	// Build requirements section
	let requirementsSection = ""
	if (phase.relatedRequirements && phase.relatedRequirements.length > 0) {
		const requirements = phase.relatedRequirements.map((req) => `<requirement>${req}</requirement>`).join("\n")
		requirementsSection = `<key_requirements>
${requirements}
</key_requirements>

`
	}

	// Build core objective section
	let objectiveSection = ""
	if (phase.coreObjectives && phase.coreObjectives.length > 0) {
		const coreObjectives = phase.coreObjectives.map((obj) => `${obj}`).join("\n")
		objectiveSection = `<core_objective>
${coreObjectives}
</core_objective>

`
	}

	// Build functional requirements section
	let functionalSection = ""
	if (phase.functionalRequirements && phase.functionalRequirements.length > 0) {
		const functionalRequirements = phase.functionalRequirements.map((req) => `${req}`).join("\n")
		functionalSection = `<functional_requirements>
${functionalRequirements}
</functional_requirements>

`
	}

	// Build deliverables section
	let deliverablesSection = ""
	if (phase.deliverables && phase.deliverables.length > 0) {
		const deliverables = phase.deliverables.map((item) => `<deliverable>${item}</deliverable>`).join("\n")
		deliverablesSection = `<expected_deliverables>
${deliverables}
</expected_deliverables>

`
	}

	// Build completion criteria section
	let completionSection = ""
	if (phase.completionCriteria && phase.completionCriteria.length > 0) {
		const criteria = phase.completionCriteria
			.map((item) => `<criterion>${item.index}. ${item.description}</criterion>`)
			.join("\n")
		completionSection = `<completion_criteria>
${criteria}
</completion_criteria>

`
	}

	// Build quality requirements section
	let qualitySection = ""
	if (phase.nonFunctionalRequirements && phase.nonFunctionalRequirements.length > 0) {
		const nonFunctionalRequirements = phase.nonFunctionalRequirements.map((req) => `${req}`).join("\n")
		qualitySection = `<quality_requirements>
${nonFunctionalRequirements}
</quality_requirements>

`
	}

	// Build handoff checklist section
	let handoffSection = ""
	if (phase.handoffChecklist && phase.handoffChecklist.length > 0) {
		const checklist = phase.handoffChecklist
			.map((item) => `<checklist_item>${item.index}. ${item.description}</checklist_item>`)
			.join("\n")
		handoffSection = `<handoff_checklist>
${checklist}
</handoff_checklist>

`
	}

	// Helper: numbered sub-tasks (guaranteed at least one – but be defensive)
	const subtasksSection =
		phase.subtasks && phase.subtasks.length
			? phase.subtasks.map((st: Subtask, i: number) => `<task>${i + 1}. ${st.description.trim()}</task>`).join("\n")
			: "<task>1. Follow the core objective and completion criteria outlined above</task>"

	// Final prompt -------------------------------------------------------------
	return `<phase_execution>
<phase_info>
<phase_number>${phase.phaseIdx}</phase_number>
<total_phases>${total - 1}</total_phases>
<phase_title>${phase.title}</phase_title>
</phase_info>

<original_user_request>
${projectOverview.trim()}
</original_user_request>

${objectiveSection}${requirementsSection}${functionalSection}<relevant_files>
${pathsSection}
</relevant_files>

<specific_tasks>
${subtasksSection}
</specific_tasks>

${deliverablesSection}${completionSection}${qualitySection}${handoffSection}<execution_guidelines>
<primary_directives>
<directive>Focus ONLY on this phase - Do not create additional phases or plans</directive>
<directive>Complete ALL tasks listed above before attempting completion</directive>
<directive>Follow the completion criteria exactly as specified</directive>
<directive>Verify handoff checklist items before marking as complete</directive>
</primary_directives>

<tool_usage>
<instruction>Use &lt;thinking&gt; to analyze prerequisites and approach</instruction>
<instruction>Use &lt;write_to_file&gt; for file creation and modifications</instruction>
<instruction>Use &lt;execute_command&gt; for terminal operations</instruction>
<instruction>Wait for tool results before proceeding to next action</instruction>
<instruction>Use &lt;attempt_completion&gt; ONLY when all criteria are met</instruction>
</tool_usage>

<success_criteria>
<criterion>All specified tasks are finished</criterion>
<criterion>All completion criteria are satisfied</criterion>
<criterion>All deliverables are created and ready</criterion>
<criterion>Handoff checklist items are verified</criterion>
</success_criteria>
</execution_guidelines>

<instruction>Begin Phase ${phase.phaseIdx} execution now.</instruction>
</phase_execution>`
}
