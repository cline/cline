import type { Controller } from '../../core/controller'
import { EnforcementRequest, EnforcementResponse, ExecuteTaskResponse } from './types'
import { runVerification, runSubstepVerification } from './verification-engine'
import { executeAndVerify, generateRequestId, getCachedExecution, cacheExecution } from './execution-engine'

let controller: Controller | null = null

export function setController(ctrl: Controller) {
	controller = ctrl
	console.log('[DELEGATES] Controller set successfully')
}

export function getController(): Controller | null {
	return controller
}

export function getWorkspaceDirectory(): string {
	if (!controller || !controller.task) {
		return process.cwd()
	}
	// Access the private cwd property using bracket notation
	return (controller.task as any).cwd || process.cwd()
}

export async function verifyStep(request: EnforcementRequest): Promise<EnforcementResponse> {
	console.log('[DELEGATE] verifyStep called for step:', request.step_id)
	return runVerification(request)
}

export async function verifySubstep(request: EnforcementRequest): Promise<EnforcementResponse> {
	console.log('[DELEGATE] verifySubstep called for substep:', request.substep_id)
	
	// Find the specific substep
	const substep = request.node?.substeps?.find(s => s.id === request.substep_id)
	if (!substep) {
		console.error('[DELEGATE] Substep not found:', request.substep_id)
		return {
			verdict: 'unclear',
			overview: `## Substep Not Found\n- Requested: ${request.substep_id}\n- Available: ${request.node?.substeps?.map(s => s.id).join(', ') || 'none'}`,
			rules_analysis: [],
			files_summary: [],
			code_blocks: [],
		}
	}
	
	console.log('[DELEGATE] Verifying substep:', substep.id, '-', substep.text)
	
	try {
		// Verify this substep - now returns same rich EnforcementResponse as steps
		const verification = await runSubstepVerification(
			request.chat_id,
			request.node?.description || '',
			substep.text,
			substep.id,
			request.node?.rules || []
		)
		
		console.log('[DELEGATE] Substep verification complete:', substep.id)
		
		// Return the rich verification response directly
		return verification
	} catch (error) {
		console.error('[DELEGATE] Substep verification error:', error)
		return {
			verdict: 'unclear',
			overview: `## Verification Failed\n- Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
			rules_analysis: [],
			files_summary: [],
			code_blocks: [],
		}
	}
}

export async function verifyRule(request: EnforcementRequest): Promise<EnforcementResponse> {
	console.log('[DELEGATE] verifyRule called for rule:', request.rule_id)
	return runVerification(request)
}

export async function executeTask(task: string, context?: Record<string, any>): Promise<ExecuteTaskResponse> {
	console.log('[DELEGATE] executeTask called:', { task, context })
	
	const requestId = generateRequestId({ task, context })
	
	const cached = getCachedExecution(requestId)
	if (cached) {
		console.log('[DELEGATE] Returning cached execution result')
		return cached
	}
	
	const taskId = `task-${Date.now()}`
	const result: ExecuteTaskResponse = {
		task_id: taskId,
		status: 'submitted',
	}
	
	cacheExecution(requestId, result)
	
	executeAndVerify(task, { ...context, taskId })
		.then((verificationResult) => {
			console.log('[DELEGATE] Task executed and verified:', verificationResult.verdict)
		})
		.catch((error) => {
			console.error('[DELEGATE] Task execution error:', error)
		})
	
	return result
}
