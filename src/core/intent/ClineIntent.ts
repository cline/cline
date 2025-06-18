export interface ClineIntent {
	readonly id: string
	readonly timestamp: number
	readonly description: string
	readonly scope: IntentScope
	readonly reversible: boolean
	readonly dependencies: readonly string[]
	readonly estimatedImpact: ImpactEstimate
	readonly status: IntentStatus
	readonly error?: string
}

export interface IntentScope {
	readonly files: readonly string[]
	readonly operations: readonly OperationType[]
	readonly affectedLines?: readonly LineRange[]
}

export interface LineRange {
	readonly file: string
	readonly start: number
	readonly end: number
}

export interface ImpactEstimate {
	readonly filesModified: number
	readonly linesAdded: number
	readonly linesRemoved: number
	readonly linesModified: number
	readonly complexity: "low" | "medium" | "high"
}

export type IntentStatus = "declared" | "approved" | "executing" | "completed" | "reverted" | "failed"

export type OperationType =
	| "create-file"
	| "modify-file"
	| "delete-file"
	| "refactor"
	| "add-feature"
	| "fix-bug"
	| "add-tests"
	| "update-docs"

export interface IntentHistory {
	readonly intents: readonly ClineIntent[]
	readonly executionOrder: readonly string[]
	readonly revertedIntents: readonly string[]
}

export const createIntent = (description: string, scope: IntentScope, dependencies: readonly string[] = []): ClineIntent => ({
	id: generateIntentId(),
	timestamp: Date.now(),
	description,
	scope,
	reversible: true,
	dependencies,
	estimatedImpact: estimateImpact(scope),
	status: "declared",
})

export const updateIntentStatus = (intent: ClineIntent, status: IntentStatus): ClineIntent => ({
	...intent,
	status,
})

export const addIntentToHistory = (history: IntentHistory, intent: ClineIntent): IntentHistory => ({
	...history,
	intents: [...history.intents, intent],
})

export const revertIntent = (history: IntentHistory, intentId: string): IntentHistory => ({
	...history,
	revertedIntents: [...history.revertedIntents, intentId],
})

const generateIntentId = (): string => {
	return `intent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

const estimateImpact = (scope: IntentScope): ImpactEstimate => {
	const fileCount = scope.files.length
	const hasRefactor = scope.operations.includes("refactor")

	return {
		filesModified: fileCount,
		linesAdded: hasRefactor ? fileCount * 10 : fileCount * 5,
		linesRemoved: hasRefactor ? fileCount * 5 : 0,
		linesModified: hasRefactor ? fileCount * 15 : fileCount * 3,
		complexity: fileCount > 5 || hasRefactor ? "high" : fileCount > 2 ? "medium" : "low",
	}
}

export const getIntentById = (history: IntentHistory, id: string): ClineIntent | undefined =>
	history.intents.find((intent) => intent.id === id)

export const getActiveIntents = (history: IntentHistory): readonly ClineIntent[] =>
	history.intents.filter((intent) => intent.status === "completed" && !history.revertedIntents.includes(intent.id))

export const getReversibleIntents = (history: IntentHistory): readonly ClineIntent[] =>
	getActiveIntents(history).filter((intent) => intent.reversible)

export const canRevertIntent = (history: IntentHistory, intentId: string): boolean => {
	const intent = getIntentById(history, intentId)
	if (!intent || !intent.reversible) return false

	const dependentIntents = history.intents.filter(
		(i) => i.dependencies.includes(intentId) && i.status === "completed" && !history.revertedIntents.includes(i.id),
	)

	return dependentIntents.length === 0
}

export const getIntentChain = (history: IntentHistory, intentId: string): readonly string[] => {
	const intent = getIntentById(history, intentId)
	if (!intent) return []

	const chain: string[] = []
	const visited = new Set<string>()

	const buildChain = (id: string) => {
		if (visited.has(id)) return
		visited.add(id)

		const current = getIntentById(history, id)
		if (!current) return

		current.dependencies.forEach(buildChain)
		chain.push(id)
	}

	buildChain(intentId)
	return chain
}
