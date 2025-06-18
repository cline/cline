import * as vscode from "vscode"
import {
	ClineIntent,
	IntentHistory,
	IntentScope,
	IntentStatus,
	createIntent,
	updateIntentStatus,
	addIntentToHistory,
	revertIntent,
	getIntentById,
	canRevertIntent,
	getIntentChain,
	getReversibleIntents,
} from "./ClineIntent"

export class IntentManager {
	private history: IntentHistory = {
		intents: [],
		executionOrder: [],
		revertedIntents: [],
	}

	private readonly context: vscode.ExtensionContext
	private readonly onIntentDeclared = new vscode.EventEmitter<ClineIntent>()
	private readonly onIntentExecuted = new vscode.EventEmitter<ClineIntent>()
	private readonly onIntentReverted = new vscode.EventEmitter<string>()

	public readonly intentDeclared = this.onIntentDeclared.event
	public readonly intentExecuted = this.onIntentExecuted.event
	public readonly intentReverted = this.onIntentReverted.event

	constructor(context: vscode.ExtensionContext) {
		this.context = context
		this.loadHistory()
	}

	private intentOperationMutex = new Map<string, Promise<any>>()
	private historyUpdateMutex: Promise<void> = Promise.resolve()

	async declareIntent(description: string, scope: IntentScope, dependencies: string[] = []): Promise<ClineIntent> {
		return this.withHistoryLock(async () => {
			const intent = createIntent(description, scope, dependencies)

			this.history = addIntentToHistory(this.history, intent)
			await this.saveHistory()

			this.onIntentDeclared.fire(intent)
			return intent
		})
	}

	async requestApproval(intentId: string): Promise<boolean> {
		const intent = getIntentById(this.history, intentId)
		if (!intent) return false

		const message = this.formatIntentForApproval(intent)
		const choice = await vscode.window.showInformationMessage(message, { modal: true }, "Approve", "Modify", "Reject")

		switch (choice) {
			case "Approve":
				await this.updateStatus(intentId, "approved")
				return true
			case "Modify":
				return await this.modifyIntent(intentId)
			default:
				await this.updateStatus(intentId, "failed")
				return false
		}
	}

	async executeIntent(intentId: string): Promise<boolean> {
		const intent = getIntentById(this.history, intentId)
		if (!intent || intent.status !== "approved") {
			throw new Error(`Intent ${intentId} not found or not approved`)
		}

		let checkpoint: string | null = null

		try {
			await this.updateStatus(intentId, "executing")

			checkpoint = await this.createCheckpoint(intent)

			const success = await this.performOperations(intent)

			if (success) {
				await this.updateStatus(intentId, "completed")
				this.history = {
					...this.history,
					executionOrder: [...this.history.executionOrder, intentId],
				}
				await this.saveHistory()
				this.onIntentExecuted.fire(intent)
				return true
			} else {
				if (checkpoint) {
					await this.restoreCheckpoint(checkpoint)
				}
				await this.updateStatus(intentId, "failed")
				throw new Error(`Intent execution failed: ${intent.description}`)
			}
		} catch (error) {
			console.error(`Intent execution failed for ${intentId}:`, error)

			if (checkpoint) {
				try {
					await this.restoreCheckpoint(checkpoint)
					console.log(`Successfully rolled back intent ${intentId}`)
				} catch (rollbackError) {
					console.error(`Rollback failed for intent ${intentId}:`, rollbackError)
					this.onIntentExecuted.fire({
						...intent,
						status: "failed",
						error: `Execution and rollback both failed: ${error.message}`,
					})
				}
			}

			try {
				await this.updateStatus(intentId, "failed")
			} catch (statusError) {
				console.error(`Failed to update status for intent ${intentId}:`, statusError)
			}

			throw new Error(`Failed to execute intent "${intent.description}": ${error.message}`)
		}
	}

	async revertIntentById(intentId: string): Promise<boolean> {
		if (!canRevertIntent(this.history, intentId)) {
			vscode.window.showErrorMessage("Cannot revert intent: has dependent operations")
			return false
		}

		const intent = getIntentById(this.history, intentId)
		if (!intent) return false

		try {
			const chain = getIntentChain(this.history, intentId)
			const message = `Revert "${intent.description}"?\n\nThis will also revert: ${chain.length - 1} dependent operations`

			const choice = await vscode.window.showWarningMessage(message, { modal: true }, "Revert", "Cancel")

			if (choice !== "Revert") return false

			for (const id of [...chain].reverse()) {
				await this.performReversion(id)
			}

			this.history = revertIntent(this.history, intentId)
			await this.saveHistory()
			this.onIntentReverted.fire(intentId)
			return true
		} catch (error) {
			console.error("Intent reversion failed:", error)
			return false
		}
	}

	async revertMultipleIntents(intentIds: string[]): Promise<boolean> {
		const reversibleIds = intentIds.filter((id) => canRevertIntent(this.history, id))

		if (reversibleIds.length === 0) {
			vscode.window.showErrorMessage("No intents can be reverted")
			return false
		}

		const message = `Revert ${reversibleIds.length} operations?`
		const choice = await vscode.window.showWarningMessage(message, { modal: true }, "Revert All", "Cancel")

		if (choice !== "Revert All") return false

		const orderedIds = this.history.executionOrder.filter((id) => reversibleIds.includes(id)).reverse()

		for (const id of orderedIds) {
			await this.revertIntentById(id)
		}

		return true
	}

	getHistory(): IntentHistory {
		return this.history
	}

	getReversibleIntents(): readonly ClineIntent[] {
		return getReversibleIntents(this.history)
	}

	getIntentsByStatus(status: IntentStatus): readonly ClineIntent[] {
		return this.history.intents.filter((intent) => intent.status === status)
	}

	private async updateStatus(intentId: string, status: IntentStatus): Promise<void> {
		const intent = getIntentById(this.history, intentId)
		if (!intent) return

		const updatedIntent = updateIntentStatus(intent, status)
		this.history = {
			...this.history,
			intents: this.history.intents.map((i) => (i.id === intentId ? updatedIntent : i)),
		}
		await this.saveHistory()
	}

	private formatIntentForApproval(intent: ClineIntent): string {
		const impact = intent.estimatedImpact
		return `Cline wants to: ${intent.description}

Files affected: ${intent.scope.files.join(", ")}
Operations: ${intent.scope.operations.join(", ")}
Estimated impact: ${impact.filesModified} files, ~${impact.linesAdded + impact.linesModified} lines
Complexity: ${impact.complexity}

Dependencies: ${intent.dependencies.length > 0 ? intent.dependencies.join(", ") : "None"}

Do you approve this operation?`
	}

	private async modifyIntent(intentId: string): Promise<boolean> {
		const intent = getIntentById(this.history, intentId)
		if (!intent) return false

		const newDescription = await vscode.window.showInputBox({
			prompt: "Modify the intent description",
			value: intent.description,
		})

		if (!newDescription) return false

		const modifiedIntent = { ...intent, description: newDescription }
		this.history = {
			...this.history,
			intents: this.history.intents.map((i) => (i.id === intentId ? modifiedIntent : i)),
		}

		await this.saveHistory()
		return await this.requestApproval(intentId)
	}

	private async createCheckpoint(intent: ClineIntent): Promise<string> {
		const checkpointId = `checkpoint-${intent.id}-${Date.now()}`
		return checkpointId
	}

	private async restoreCheckpoint(checkpointId: string): Promise<void> {
		console.log(`Restoring checkpoint: ${checkpointId}`)
	}

	private async performOperations(intent: ClineIntent): Promise<boolean> {
		console.log(`Executing intent: ${intent.description}`)
		console.log(`Files: ${intent.scope.files.join(", ")}`)
		console.log(`Operations: ${intent.scope.operations.join(", ")}`)

		return true
	}

	private async performReversion(intentId: string): Promise<void> {
		const intent = getIntentById(this.history, intentId)
		if (!intent) return

		console.log(`Reverting intent: ${intent.description}`)
	}

	private async saveHistory(): Promise<void> {
		const cleanedHistory = this.cleanupOldIntents(this.history)

		const validatedHistory = this.validateIntentHistory(cleanedHistory)
		const historyWithChecksum = this.addDataChecksum(validatedHistory)

		await this.createBackup(historyWithChecksum)

		try {
			await this.context.globalState.update("intentHistory", historyWithChecksum)
			this.history = cleanedHistory
		} catch (error) {
			console.error("Failed to save intent history:", error)
			await this.restoreFromBackup()
			throw new Error(`Intent history save failed: ${error.message}`)
		}
	}

	private loadHistory(): void {
		try {
			const saved = this.context.globalState.get<IntentHistory>("intentHistory")
			if (saved) {
				const validatedHistory = this.validateDataIntegrity(saved)
				this.history = this.cleanupOldIntents(validatedHistory)
			}
		} catch (error) {
			console.error("Intent history corrupted, attempting recovery:", error)
			this.recoverFromCorruption()
		}
	}

	private cleanupOldIntents(history: IntentHistory): IntentHistory {
		const MAX_INTENTS = 1000
		const MAX_AGE_DAYS = 30
		const cutoffTime = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000

		const recentIntents = history.intents.filter((intent) => intent.timestamp > cutoffTime).slice(-MAX_INTENTS)

		const keptIntentIds = new Set(recentIntents.map((i) => i.id))
		const cleanExecutionOrder = history.executionOrder.filter((id) => keptIntentIds.has(id))
		const cleanRevertedIntents = history.revertedIntents.filter((id) => keptIntentIds.has(id))

		return {
			intents: recentIntents,
			executionOrder: cleanExecutionOrder,
			revertedIntents: cleanRevertedIntents,
		}
	}

	getMemoryUsage(): { intentCount: number; estimatedSizeKB: number } {
		const intentCount = this.history.intents.length
		const estimatedSizeKB = intentCount * 1
		return { intentCount, estimatedSizeKB }
	}

	async archiveOldIntents(): Promise<number> {
		const MAX_AGE_DAYS = 30
		const cutoffTime = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000

		const oldIntents = this.history.intents.filter((intent) => intent.timestamp <= cutoffTime)

		if (oldIntents.length > 0) {
			const existingArchive = this.context.globalState.get<ClineIntent[]>("archivedIntents") || []
			const newArchive = [...existingArchive, ...oldIntents]
			await this.context.globalState.update("archivedIntents", newArchive)

			this.history = this.cleanupOldIntents(this.history)
			await this.saveHistory()
		}

		return oldIntents.length
	}

	private async withHistoryLock<T>(operation: () => Promise<T>): Promise<T> {
		const previousMutex = this.historyUpdateMutex

		this.historyUpdateMutex = previousMutex
			.then(async () => {
				try {
					return await operation()
				} catch (error) {
					console.error("History operation failed:", error)
					throw error
				}
			})
			.then(() => {})

		return previousMutex.then(() => operation())
	}

	private async withIntentLock<T>(intentId: string, operation: () => Promise<T>): Promise<T> {
		const existingOperation = this.intentOperationMutex.get(intentId)
		if (existingOperation) {
			throw new Error(`Intent ${intentId} is already being processed`)
		}

		const operationPromise = operation().finally(() => {
			this.intentOperationMutex.delete(intentId)
		})

		this.intentOperationMutex.set(intentId, operationPromise)
		return operationPromise
	}

	private detectDeadlock(intentId: string, dependencies: string[]): boolean {
		const visited = new Set<string>()
		const recursionStack = new Set<string>()

		const hasCycle = (id: string): boolean => {
			if (recursionStack.has(id)) return true
			if (visited.has(id)) return false

			visited.add(id)
			recursionStack.add(id)

			const intent = getIntentById(this.history, id)
			if (intent) {
				for (const dep of intent.dependencies) {
					if (hasCycle(dep)) return true
				}
			}

			recursionStack.delete(id)
			return false
		}

		for (const dep of dependencies) {
			if (hasCycle(dep)) return true
		}

		return false
	}

	private validateIntentHistory(history: IntentHistory): IntentHistory {
		if (!history || typeof history !== "object") {
			throw new Error("Invalid intent history: not an object")
		}

		if (!Array.isArray(history.intents)) {
			throw new Error("Invalid intent history: intents must be an array")
		}

		if (!Array.isArray(history.executionOrder)) {
			throw new Error("Invalid intent history: executionOrder must be an array")
		}

		if (!Array.isArray(history.revertedIntents)) {
			throw new Error("Invalid intent history: revertedIntents must be an array")
		}

		for (const intent of history.intents) {
			this.validateIntent(intent)
		}

		const intentIds = new Set(history.intents.map((i) => i.id))
		for (const id of history.executionOrder) {
			if (!intentIds.has(id)) {
				console.warn(`Execution order references non-existent intent: ${id}`)
			}
		}

		return history
	}

	private validateIntent(intent: ClineIntent): void {
		if (!intent || typeof intent !== "object") {
			throw new Error("Invalid intent: not an object")
		}

		if (!intent.id || typeof intent.id !== "string") {
			throw new Error("Invalid intent: missing or invalid id")
		}

		if (!intent.description || typeof intent.description !== "string") {
			throw new Error("Invalid intent: missing or invalid description")
		}

		if (!intent.scope || typeof intent.scope !== "object") {
			throw new Error("Invalid intent: missing or invalid scope")
		}

		if (!Array.isArray(intent.scope.files)) {
			throw new Error("Invalid intent: scope.files must be an array")
		}

		if (!Array.isArray(intent.scope.operations)) {
			throw new Error("Invalid intent: scope.operations must be an array")
		}

		if (typeof intent.timestamp !== "number" || intent.timestamp <= 0) {
			throw new Error("Invalid intent: invalid timestamp")
		}
	}

	private addDataChecksum(history: IntentHistory): any {
		const historyString = JSON.stringify(history)
		const checksum = this.calculateChecksum(historyString)

		return {
			data: history,
			checksum,
			version: "1.0",
			timestamp: Date.now(),
		}
	}

	private calculateChecksum(data: string): string {
		let hash = 0
		for (let i = 0; i < data.length; i++) {
			const char = data.charCodeAt(i)
			hash = (hash << 5) - hash + char
			hash = hash & hash
		}
		return hash.toString(16)
	}

	private validateDataIntegrity(saved: any): IntentHistory {
		if (!saved || typeof saved !== "object") {
			throw new Error("Invalid saved data format")
		}

		if (saved.intents && !saved.data) {
			console.warn("Loading legacy intent history format")
			return this.validateIntentHistory(saved as IntentHistory)
		}

		if (!saved.data || !saved.checksum) {
			throw new Error("Invalid saved data: missing data or checksum")
		}

		const dataString = JSON.stringify(saved.data)
		const expectedChecksum = this.calculateChecksum(dataString)

		if (saved.checksum !== expectedChecksum) {
			throw new Error("Data corruption detected: checksum mismatch")
		}

		return this.validateIntentHistory(saved.data)
	}

	private async createBackup(data: any): Promise<void> {
		try {
			const backupKey = `intentHistoryBackup_${Date.now()}`
			await this.context.globalState.update(backupKey, data)

			const allKeys = this.context.globalState.keys()
			const backupKeys = allKeys
				.filter((key) => key.startsWith("intentHistoryBackup_"))
				.sort()
				.reverse()

			for (let i = 3; i < backupKeys.length; i++) {
				await this.context.globalState.update(backupKeys[i], undefined)
			}
		} catch (error) {
			console.error("Failed to create backup:", error)
		}
	}

	private async restoreFromBackup(): Promise<void> {
		try {
			const allKeys = this.context.globalState.keys()
			const backupKeys = allKeys
				.filter((key) => key.startsWith("intentHistoryBackup_"))
				.sort()
				.reverse()

			for (const backupKey of backupKeys) {
				try {
					const backup = this.context.globalState.get(backupKey)
					if (backup) {
						const validatedHistory = this.validateDataIntegrity(backup)
						this.history = this.cleanupOldIntents(validatedHistory)
						console.log(`Successfully restored from backup: ${backupKey}`)
						return
					}
				} catch (error) {
					console.warn(`Backup ${backupKey} is also corrupted:`, error)
					continue
				}
			}

			console.warn("No valid backups found, resetting to empty history")
			this.history = { intents: [], executionOrder: [], revertedIntents: [] }
		} catch (error) {
			console.error("Failed to restore from backup:", error)
			this.history = { intents: [], executionOrder: [], revertedIntents: [] }
		}
	}

	private recoverFromCorruption(): void {
		console.warn("Attempting to recover from data corruption")

		try {
			this.restoreFromBackup()
		} catch (error) {
			console.error("Recovery failed, starting with empty history:", error)
			this.history = { intents: [], executionOrder: [], revertedIntents: [] }
		}

		vscode.window.showWarningMessage(
			"Intent history was corrupted and has been recovered from backup. Some recent intents may be lost.",
			"OK",
		)
	}

	async migrateDataFormat(): Promise<void> {
		const saved = this.context.globalState.get<any>("intentHistory")
		if (!saved) return

		if (saved.version && saved.version === "1.0") {
			return
		}

		console.log("Migrating intent history to new format")

		try {
			const legacyHistory = saved as IntentHistory
			const validatedHistory = this.validateIntentHistory(legacyHistory)
			const migratedData = this.addDataChecksum(validatedHistory)

			await this.context.globalState.update("intentHistory", migratedData)
			console.log("Successfully migrated intent history format")
		} catch (error) {
			console.error("Failed to migrate data format:", error)
		}
	}

	dispose(): void {
		this.onIntentDeclared.dispose()
		this.onIntentExecuted.dispose()
		this.onIntentReverted.dispose()
	}
}
