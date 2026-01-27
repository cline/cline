import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

export type ZoroStatus = "pending" | "in_progress" | "completed" | "blocked"

export interface ZoroCLIResult {
	success: boolean
	output: string
	error?: string
}

export class ZoroCLIAdapter {
	private workspaceRoot: string
	private dryRun: boolean

	constructor(workspaceRoot: string, dryRun: boolean = false) {
		this.workspaceRoot = workspaceRoot
		this.dryRun = dryRun
	}

	async updateStep(stepId: string, status: ZoroStatus): Promise<ZoroCLIResult> {
		const command = `zoro update-step ${stepId} ${status}`
		return this.executeCommand(command)
	}

	async addNote(stepId: string, note: string): Promise<ZoroCLIResult> {
		const escapedNote = note.replace(/"/g, '\\"')
		const command = `zoro add-note ${stepId} "${escapedNote}"`
		return this.executeCommand(command)
	}

	async completeStep(stepId: string, rulesUsed?: string[]): Promise<ZoroCLIResult> {
		let command = `zoro complete-step ${stepId}`
		if (rulesUsed && rulesUsed.length > 0) {
			command += ` --rules-used "${rulesUsed.join(",")}"`
		}
		return this.executeCommand(command)
	}

	async updateSubstep(stepId: string, substepId: string, status: "pending" | "completed"): Promise<ZoroCLIResult> {
		const command = `zoro update-substep ${stepId} ${substepId} ${status}`
		return this.executeCommand(command)
	}

	async getPlanStatus(chatId: string): Promise<ZoroCLIResult> {
		const command = `zoro get-status --chat-id ${chatId}`
		return this.executeCommand(command)
	}

	private async executeCommand(command: string): Promise<ZoroCLIResult> {
		if (this.dryRun) {
			console.log(`[DRY RUN] Would execute: ${command}`)
			return {
				success: true,
				output: `[DRY RUN] ${command}`,
			}
		}

		try {
			const { stdout, stderr } = await execAsync(command, {
				cwd: this.workspaceRoot,
				timeout: 30000,
			})

			return {
				success: true,
				output: stdout.trim(),
				error: stderr ? stderr.trim() : undefined,
			}
		} catch (error: any) {
			return {
				success: false,
				output: "",
				error: error.message || "Unknown error",
			}
		}
	}

	static async isZoroAvailable(): Promise<boolean> {
		try {
			await execAsync("zoro --version", { timeout: 5000 })
			return true
		} catch {
			return false
		}
	}
}
