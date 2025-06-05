// src/core/assistant-message/phase-tracker.ts
import { Controller } from "../controller"
import { buildPhasePrompt } from "./prompts"
import * as vscode from "vscode"

export type PhaseStatus = "in-complete" | "approved"

export enum PhaseExecutionMode {
	Sequential,
	Parallel,
	Contional,
}

export interface Phase {
	index: number
	phase_prompt?: string
	title: string
	description?: string
	paths: string[]
	subtasks: Subtask[]
	complete: boolean
}

export interface Subtask {
	index: number
	description: string
	completed: boolean
}

export interface SubtaskState {
	index: number
	subtask: Subtask
	result?: string
	startTime?: number
	endTime?: number
}

export interface PhaseState {
	index: number
	origin_prompt?: string
	phase?: Phase
	subtasks: SubtaskState[]
	complete: boolean
	status: PhaseStatus | "in-progress" | "completed" | "skipped"
	startTime?: number
	endTime?: number
}

export interface PhaseResult {
	phaseId: number
	summary: string
	subtaskResults: Record<string, string>
	executionTime: number
}

export interface ParsedPlan {
	rawPlan: string
	phases: Phase[]
}

export function parsePhases(rawPlan: string): Phase[] {
	const planContent = rawPlan

	// Slice and push for each Phase header
	interface PhaseInfo {
		index: number
		phase_prompt: string
		title: string
		description: string
		paths: string[]
		subtasks: string[]
	}

	const phaseMatches: PhaseInfo[] = []
	const headerRegex = /^Phase\s*(\d+)\s*[:\-]\s*([^\r\n]+)/gim
	const matches = Array.from(planContent.matchAll(headerRegex))

	for (let i = 0; i < matches.length; i++) {
		const h = matches[i]
		const idx = parseInt(h[1], 10)
		const title = h[2].trim()

		// The block extends from right after this header until the start of the next header
		const start = (h.index ?? 0) + h[0].length
		// peek ahead to find the start index of the next header
		const end = i + 1 < matches.length ? (matches[i + 1].index ?? planContent.length) : planContent.length

		const block = planContent.slice(start, end).trim()
		// Parse description / paths / subtasks from the block
		const description = /-?\s*Description:\s*([^\r\n]+)/i.exec(block)?.[1].trim() || ""

		const pathsMatch = /-?\s*Paths:\s*([\s\S]*?)(?=(?:-?\s*Description:|-?\s*Subtasks:|$))/i.exec(block)
		const pathsText = pathsMatch ? pathsMatch[1] : ""
		const paths = pathsText
			.split(/\r?\n/)
			.map((l) => l.replace(/^[\s*•\-\s]+/, "").trim())
			.filter((l) => l.length > 0)

		const subtaskMatch = /-?\s*Subtasks:\s*([\s\S]*)/i.exec(block)
		const subtaskText = subtaskMatch ? subtaskMatch[1] : ""
		const subtasks = subtaskText
			.split(/\r?\n/)
			.map((l) => l.replace(/^[\s*•\-\s]+/, "").trim())
			.filter((l) => l.length > 0)

		phaseMatches.push({
			index: idx,
			phase_prompt: h[0].trim(),
			title: title,
			description: description,
			paths: paths,
			subtasks: subtasks,
		})
	}

	if (phaseMatches.length > 0) {
		return createPhasesFromMatches(phaseMatches)
	}
	return []
}

function createPhasesFromMatches(
	phaseMatches: {
		index: number
		phase_prompt: string
		title: string
		description: string
		paths: string[]
		subtasks: string[]
	}[],
): Phase[] {
	// Create phases from the numbered list descriptions
	const phases: Phase[] = phaseMatches.map((phaseMatch) => ({
		index: phaseMatch.index,
		phase_prompt: phaseMatch.phase_prompt,
		title: phaseMatch.title,
		description: phaseMatch.description,
		paths: phaseMatch.paths,
		subtasks: phaseMatch.subtasks.map((subtask, i) => ({
			index: i,
			description: subtask,
			completed: false,
		})),
		complete: false,
	}))
	return phases
}

export function parsePlanFromOutput(raw: string): ParsedPlan {
	const planRegex = /##\s*Phase\s*Plan\s*[\r\n]+([\s\S]*)$/im
	const planMatch = planRegex.exec(raw)
	if (!planMatch) {
		throw new Error("No Phase Plan section found in the input text")
	}

	const rawPlan = planMatch[1].trim()

	const phases = parsePhases(rawPlan)
	if (phases.length === 0) {
		throw new Error("No phases found in the Phase Plan content")
	}

	return { rawPlan, phases }
}

export class PhaseTracker {
	private phaseStates: PhaseState[] = []
	public currentPhaseIndex = 0
	private phaseResults: PhaseResult[] = []
	private executionConfig: any
	private phaseExecutionMode: PhaseExecutionMode = PhaseExecutionMode.Sequential
	private checkpointEnabled: boolean = true
	private checkpointFrequency: "phase" | "subtask" | "never" = "phase"
	private phaseChangeListeners: ((
		phaseId: number,
		newStatus: PhaseStatus | "in-progress" | "completed" | "skipped",
	) => void)[] = []

	public rawPlanContent?: string

	constructor(
		private originalPrompt: string,
		private controller: Controller,
		private outputChannel: vscode.OutputChannel,
	) {
		// Step 1: Set up the first Phase (Plan) in Plan Mode
		this.phaseStates.push({
			index: 0,
			origin_prompt: originalPrompt,
			phase: {
				index: 0,
				phase_prompt: "Plan Phase",
				title: "Plan Phase",
				description: "",
				paths: [],
				subtasks: [],
				complete: false,
			},
			subtasks: [],
			complete: false,
			status: "in-complete",
			startTime: Date.now(),
		})
	}

	// Called after the Plan phase is completed to populate the actual execution Phase list.
	public addPhasesFromPlan(parsedPhases: Phase[]): void {
		parsedPhases.forEach((p) => {
			this.phaseStates.push({
				index: p.index,
				phase: p,
				subtasks: p.subtasks.map((st, i) => ({
					index: i,
					subtask: st,
				})),
				complete: false,
				status: "in-complete",
				startTime: Date.now(),
				endTime: undefined,
			})
		})
		this.outputChannel.appendLine(`PhaseTracker: ${parsedPhases.length} phases registered.`)
		this.saveCheckpoint().catch(() => {})
	}

	public completeSubtask(phaseId: number, subtaskId: number, result?: string): void {
		const phase = this.phaseStates.find((p) => p.index === phaseId)
		if (!phase) {
			return
		}
		const st = phase.subtasks.find((s) => s.index === subtaskId)
		if (!st) {
			return
		}
		st.subtask.completed = true
		st.result = result
		st.endTime = Date.now()
		this.outputChannel.appendLine(`Subtask ${subtaskId} of Phase ${phaseId} completed.`)
		if (phase.subtasks.every((s) => s.subtask.completed)) {
			this.completePhase(phase.index)
		}
		if (this.checkpointEnabled && this.checkpointFrequency === "subtask") {
			this.saveCheckpoint()
		}
	}

	public markCurrentPhaseComplete(summary: string = ""): void {
		const id = this.phaseStates[this.currentPhaseIndex].index
		this.completePhase(id, summary)
	}

	private completePhase(phaseId: number, summary: string = ""): void {
		const phase = this.phaseStates.find((p) => p.index === phaseId)
		if (!phase) {
			return
		}
		phase.subtasks.forEach((st) => {
			if (!st.subtask.completed) {
				st.subtask.completed = true
			}
			st.endTime = st.endTime || Date.now()
		})
		phase.complete = true
		phase.status = "completed"
		phase.endTime = Date.now()
		const result: PhaseResult = {
			phaseId,
			summary,
			subtaskResults: phase.subtasks.reduce((acc, st) => ({ ...acc, [st.index]: st.result || "" }), {}),
			executionTime: (phase.endTime || Date.now()) - (phase.startTime || 0),
		}
		this.phaseResults.push(result)
		this.notifyPhaseChange(phaseId, "completed")
		if (this.checkpointEnabled && this.checkpointFrequency === "phase") {
			this.saveCheckpoint()
		}
	}

	public hasNextPhase(): boolean {
		return this.currentPhaseIndex < this.phaseStates.length - 1
	}

	public async moveToNextPhase(openNewTask: boolean = false): Promise<void> {
		const current = this.phaseStates[this.currentPhaseIndex]
		if (!current.complete) {
			this.completePhase(current.index)
		}
		this.currentPhaseIndex++
		const next = this.phaseStates[this.currentPhaseIndex]
		next.status = "in-progress"
		next.startTime = Date.now()

		this.notifyPhaseChange(next.index, "in-progress")
		await this.controller.clearTask()
		if (openNewTask) {
			const nextPhase = this.phaseStates[this.currentPhaseIndex].phase
			let nextPhasePrompt = ""
			if (nextPhase) {
				nextPhasePrompt = buildPhasePrompt(nextPhase, this.totalPhases, this.getOriginalPrompt())
			}
			await this.controller.spawnPhaseTask(nextPhasePrompt, next.index)
		}
	}

	public get currentPhase(): Phase {
		const p = this.phaseStates[this.currentPhaseIndex]
		if (!p || !p.phase) {
			throw new Error(`Phase ${this.currentPhaseIndex} is not properly initialized: missing phase data`)
		}
		return p.phase
	}

	public get totalPhases(): number {
		return this.phaseStates.length
	}

	public isAllComplete(): boolean {
		return this.phaseStates.every((p) => p.complete)
	}

	private notifyPhaseChange(id: number, status: PhaseStatus | "in-progress" | "completed" | "skipped"): void {
		this.phaseChangeListeners.forEach((l) => {
			try {
				l(id, status)
			} catch {}
		})
	}

	public getOriginalPrompt(): string {
		return this.originalPrompt
	}

	private async saveCheckpoint(): Promise<void> {
		try {
			// 1) Determine the base URI for saving
			let baseUri: vscode.Uri
			const ws = vscode.workspace.workspaceFolders
			if (ws && ws.length > 0) {
				// If workspace is open, create .cline directory under the first folder
				baseUri = vscode.Uri.joinPath(ws[0].uri, ".cline")
			} else {
				// If no workspace is available, use the extension's globalStorageUri
				// ("globalStorage" permission is required in package.json)
				baseUri = vscode.Uri.joinPath(this.controller.context.globalStorageUri, ".cline")
			}

			// 2) Create the .cline directory if it doesn't exist
			try {
				await vscode.workspace.fs.stat(baseUri)
			} catch {
				await vscode.workspace.fs.createDirectory(baseUri)
			}

			// 3) Prepare checkpoint data
			const checkpointData: Record<string, any> = {
				originalPrompt: this.originalPrompt,
				rawPlanContent: this.rawPlanContent,
				phaseStates: this.phaseStates, // PhaseState[]
				currentPhaseIndex: this.currentPhaseIndex, // number
				phaseResults: this.phaseResults, // PhaseResult[]
				executionConfig: this.executionConfig, // any
				phaseExecutionMode: this.phaseExecutionMode, // enum
				checkpointEnabled: this.checkpointEnabled, // boolean
				checkpointFrequency: this.checkpointFrequency, // "phase" | "subtask" | "never"
			}
			const content = JSON.stringify(checkpointData, null, 2)

			const checkpointUri = vscode.Uri.joinPath(baseUri, "phase-checkpoint.json")
			const tmpUri = vscode.Uri.joinPath(baseUri, "phase-checkpoint.json.tmp")
			const encoder = new TextEncoder()
			await vscode.workspace.fs.writeFile(tmpUri, encoder.encode(content))
			await vscode.workspace.fs.rename(tmpUri, checkpointUri, { overwrite: true })
		} catch (error) {}
	}

	/** Restore tracker progress from .cline/phase-checkpoint.json if present */
	public static async fromCheckpoint(
		controller: Controller,
		outputChannel: vscode.OutputChannel,
	): Promise<PhaseTracker | undefined> {
		try {
			// 1) Determine the base URI for storage (prefer workspace, fallback to globalStorage)
			let baseUri: vscode.Uri
			const ws = vscode.workspace.workspaceFolders
			if (ws && ws.length > 0) {
				baseUri = vscode.Uri.joinPath(ws[0].uri, ".cline")
			} else {
				baseUri = vscode.Uri.joinPath(controller.context.globalStorageUri, ".cline")
			}

			// 2) Checkpoint file path
			const checkpointUri = vscode.Uri.joinPath(baseUri, "phase-checkpoint.json")

			// 3) Read file
			const data = await vscode.workspace.fs.readFile(checkpointUri)
			const text = new TextDecoder().decode(data)
			const checkpoint = JSON.parse(text)

			// 4) Restore PhaseTracker
			const tracker = new PhaseTracker(checkpoint.originalPrompt, controller, outputChannel)
			tracker.phaseStates = checkpoint.phaseStates
			tracker.currentPhaseIndex = checkpoint.currentPhaseIndex
			tracker.rawPlanContent = checkpoint.rawPlanContent
			tracker.phaseResults = checkpoint.phaseResults
			tracker.executionConfig = checkpoint.executionConfig
			tracker.phaseExecutionMode = checkpoint.phaseExecutionMode
			tracker.checkpointEnabled = checkpoint.checkpointEnabled
			tracker.checkpointFrequency = checkpoint.checkpointFrequency
			// also save rawPlanContent if available - optional
			if (checkpoint.rawPlanContent) {
				;(tracker as any).rawPlanContent = checkpoint.rawPlanContent
			}
			// Restored phase checkpoint
			return tracker
		} catch (err) {
			// No phase checkpoint to restore or failed
			return undefined
		}
	}
}
