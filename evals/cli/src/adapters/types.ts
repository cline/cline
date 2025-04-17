/**
 * Represents a task to be executed
 */
export interface Task {
	id: string
	name: string
	description: string
	workspacePath: string
	setupCommands: string[]
	verificationCommands: string[]
	metadata: Record<string, any>
}

/**
 * Result of verifying a task execution
 */
export interface VerificationResult {
	success: boolean
	metrics: Record<string, any>
}

/**
 * Interface for benchmark adapters
 */
export interface BenchmarkAdapter {
	name: string
	setup(): Promise<void>
	listTasks(): Promise<Task[]>
	prepareTask(taskId: string): Promise<Task>
	verifyResult(task: Task, result: any): Promise<VerificationResult>
}
