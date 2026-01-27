export interface EnforcementRequest {
	chat_id: string
	step_id?: string
	node?: PlanNode
	substep_id?: string
	rule_id?: string
	task?: string
	context?: Record<string, any>
}

export interface PlanNode {
	id: string
	type: 'code-style' | 'checking-with-user' | 'planning' | 'debugging' | 'testing'
	description: string
	status?: string
	substeps?: Array<{
		id: string
		text: string
		completed: boolean
	}>
	rules?: Array<{
		rule_id: string
		name: string
		description: string
		source: string
	}>
	audit?: Array<{
		at: string
		who: string
		action: string
		details?: string
	}>
}

export interface RuleAnalysis {
	rule_id: string
	rule_text: string
	followed: boolean
	evidence: string
	used_in_substeps?: string[]
}

export interface FileSummary {
	path: string
	lines_changed: string
	changes: string
	impact: string
	substeps_fulfilled: string[]
}

export interface CodeBlock {
	file: string
	lines: string
	code: string
	annotation: string
}

export interface EnforcementResponse {
	verdict: 'done' | 'not_done' | 'partial' | 'unclear'
	overview: string
	rules_analysis: RuleAnalysis[]
	files_summary?: FileSummary[]
	code_blocks?: CodeBlock[]
}

export interface ExecuteTaskResponse {
	task_id: string
	status: 'submitted' | 'running' | 'completed' | 'failed'
}

export function validateEnforcementRequest(body: any): {
	valid: boolean
	error?: string
	data?: EnforcementRequest
} {
	if (!body || typeof body !== 'object') {
		return { valid: false, error: 'Request body must be an object' }
	}

	if (!body.chat_id || typeof body.chat_id !== 'string') {
		return { valid: false, error: 'chat_id is required and must be a string' }
	}

	if (body.step_id !== undefined && typeof body.step_id !== 'string') {
		return { valid: false, error: 'step_id must be a string if provided' }
	}

	if (body.substep_id !== undefined && typeof body.substep_id !== 'string') {
		return { valid: false, error: 'substep_id must be a string if provided' }
	}

	if (body.rule_id !== undefined && typeof body.rule_id !== 'string') {
		return { valid: false, error: 'rule_id must be a string if provided' }
	}

	return {
		valid: true,
		data: body as EnforcementRequest,
	}
}

export function validateExecuteTaskRequest(body: any): {
	valid: boolean
	error?: string
	data?: { task: string; context?: Record<string, any> }
} {
	if (!body || typeof body !== 'object') {
		return { valid: false, error: 'Request body must be an object' }
	}

	if (!body.task || typeof body.task !== 'string') {
		return { valid: false, error: 'task is required and must be a string' }
	}

	return {
		valid: true,
		data: { task: body.task, context: body.context },
	}
}
