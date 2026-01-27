import { ZoroPlanParser, type ParsedPlan, type ParsedStep } from "./ZoroPlanParser"
import { ZoroCLIAdapter, type ZoroStatus, type ZoroCLIResult } from "./ZoroCLIAdapter"

export class ZoroService {
	private workspaceRoot: string
	private cliAdapter: ZoroCLIAdapter
	private cachedPlan: ParsedPlan | null = null
	private cacheTimestamp: number = 0
	private cacheTTL: number = 5000

	constructor(workspaceRoot: string, dryRun: boolean = false) {
		this.workspaceRoot = workspaceRoot
		this.cliAdapter = new ZoroCLIAdapter(workspaceRoot, dryRun)
	}

	getPlan(forceRefresh: boolean = false): ParsedPlan | null {
		const now = Date.now()
		if (!forceRefresh && this.cachedPlan && now - this.cacheTimestamp < this.cacheTTL) {
			return this.cachedPlan
		}

		this.cachedPlan = ZoroPlanParser.parsePlan(this.workspaceRoot)
		this.cacheTimestamp = now
		return this.cachedPlan
	}

	getStep(stepId: string, forceRefresh: boolean = false): ParsedStep | null {
		const plan = this.getPlan(forceRefresh)
		if (!plan) return null

		return plan.steps.find((s) => s.id === stepId) || null
	}

	getCurrentStep(forceRefresh: boolean = false): ParsedStep | null {
		const plan = this.getPlan(forceRefresh)
		if (!plan) return null

		const inProgress = plan.steps.find((s) => s.status === "in_progress")
		if (inProgress) return inProgress

		return plan.steps.find((s) => s.status === "pending") || null
	}

	getPlanStats(forceRefresh: boolean = false): {
		totalSteps: number
		pending: number
		inProgress: number
		completed: number
		blocked: number
	} {
		const plan = this.getPlan(forceRefresh)
		if (!plan) {
			return { totalSteps: 0, pending: 0, inProgress: 0, completed: 0, blocked: 0 }
		}

		return {
			totalSteps: plan.steps.length,
			pending: plan.steps.filter((s) => s.status === "pending").length,
			inProgress: plan.steps.filter((s) => s.status === "in_progress").length,
			completed: plan.steps.filter((s) => s.status === "completed").length,
			blocked: plan.steps.filter((s) => s.status === "blocked").length,
		}
	}

	async updateStepStatus(stepId: string, status: ZoroStatus): Promise<ZoroCLIResult> {
		const result = await this.cliAdapter.updateStep(stepId, status)
		if (result.success) {
			this.cacheTimestamp = 0
		}
		return result
	}

	async addStepNote(stepId: string, note: string): Promise<ZoroCLIResult> {
		const result = await this.cliAdapter.addNote(stepId, note)
		if (result.success) {
			this.cacheTimestamp = 0
		}
		return result
	}

	async completeStep(stepId: string, rulesUsed?: string[]): Promise<ZoroCLIResult> {
		const result = await this.cliAdapter.completeStep(stepId, rulesUsed)
		if (result.success) {
			this.cacheTimestamp = 0
		}
		return result
	}

	async updateSubstepStatus(
		stepId: string,
		substepId: string,
		status: "pending" | "completed"
	): Promise<ZoroCLIResult> {
		const result = await this.cliAdapter.updateSubstep(stepId, substepId, status)
		if (result.success) {
			this.cacheTimestamp = 0
		}
		return result
	}

	static async isAvailable(): Promise<boolean> {
		return ZoroCLIAdapter.isZoroAvailable()
	}

	hasPlan(): boolean {
		return this.getPlan() !== null
	}

	getChatId(): string | null {
		const plan = this.getPlan()
		return plan?.chatId || null
	}
}

export type { ParsedPlan, ParsedStep, ParsedRule, ParsedSubstep } from "./ZoroPlanParser"
export type { ZoroStatus, ZoroCLIResult } from "./ZoroCLIAdapter"
