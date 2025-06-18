// src/core/assistant-message/phase-tracker.ts
import { Controller } from "../controller"
import { buildPhasePrompt } from "./build_prompt"
import * as vscode from "vscode"

export enum PhaseStatus {
	Pending = "pending",
	InProgress = "in-progress",
	Completed = "completed",
	Skipped = "skipped",
	Failed = "failed",
}

export interface Phase {
	phaseIdx: number
	title: string
	exeOrderIdx: number
	prerequisites?: string[]
	relatedRequirements?: string[]
	requirementCoverage?: string[]
	coreObjectives?: string[]
	functionalRequirements?: string[]
	deliverables?: string[]
	nonFunctionalRequirements?: string[]
	completionCriteria?: Subtask[]
	handoffChecklist?: Subtask[]
	integrationObjectives?: string[]
	integrationSteps?: string[]
	originalRequirementsValidations?: Subtask[]
	systemWideTesting?: string[]
	finalDeliverables?: Subtask[]
	paths?: string[]
	subtasks?: Subtask[]
}

export interface Subtask {
	index: number
	description: string
	completed: boolean
}

export interface PhaseState {
	index: number
	projOverview?: string
	executionPlan?: string
	requirements?: RequirementInventory
	phase?: Phase
	status: PhaseStatus
	startTime?: number
	endTime?: number
}

export interface Requirement {
	id: string
	description: string
}

export type RequirementInventory = Record<string, string>

export interface PhaseResult {
	phaseId: number
	summary: string
	subtaskResults: Record<string, string>
	executionTime: number
}

export interface ParsedPlan {
	projOverview: string
	executionPlan: string
	requirements: RequirementInventory
	phases: Phase[]
}

function extractTag(tag: string, source: string): string {
	//   <tag>   (including all spaces)   </tag>
	const re = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, "i")
	const match = source.match(re)
	return match ? match[1].trim() : ""
}

export function parseProjectOverview(source: string): string {
	// Extract only the project_overview block
	const projViewRe = /<project_overview>([\s\S]*?)<\/project_overview>/i
	const pvMatch = source.match(projViewRe)
	if (!pvMatch) {
		throw new Error("project_overview section not found.")
	}
	const projOverview = pvMatch[1].trim()
	return projOverview
}

export function parseExecutionPlan(raw: string): string {
	// Extract the execution plan section from the raw text
	const planRegex = /<execution_plan>([\s\S]*?)<\/execution_plan>/i
	const planMatch = raw.match(planRegex)
	if (!planMatch) {
		// throw new Error("No execution plan section found in the input text")
		return ""
	}
	const executionPlan = planMatch[1].trim()
	return executionPlan
}

export function parseRequirement(raw: string): RequirementInventory {
	// Extract the requirement inventory section from the raw text
	const invRe = /<requirement_inventory>([\s\S]*?)<\/requirement_inventory>/i
	const invMatch = raw.match(invRe)
	if (!invMatch) {
		throw new Error("No requirement inventory section found in the input text")
	}
	const inventoryRaw = invMatch[1].trim()

	const lines = inventoryRaw.split(/\r?\n/)
	const inventory: RequirementInventory = {}

	for (const rawLine of lines) {
		const line = rawLine.trim()
		if (!line) {
			continue
		}
		const reqMatch = line.match(/^-+\s*(REQ-\d{3})\s*:\s*(.+)$/i)
		if (reqMatch) {
			const [, id, description] = reqMatch
			inventory[id] = description.trim()
		}
	}
	return inventory
}

/** Convert checklist lines to Subtask[] */
function parseChecklist(tag: string, block: string): Subtask[] {
	const criteria = extractTag(tag, block)
	if (!criteria) {
		// fallback: use Phase title as a single Subtask
		return [{ index: 1, description: extractTag(block, "title"), completed: false }]
	}

	const subtasks: Subtask[] = []
	let subIdx = 1
	criteria.split(/\r?\n/).forEach((ln) => {
		// - [ ] content   |   - content   |   1. content
		const m = ln.match(/^\s*(?:[-*]|\d+\.)\s*(?:\[\s*\]\s*)?(.+)$/)
		if (m) {
			subtasks.push({ index: subIdx++, description: m[1].trim(), completed: false })
		}
	})

	// If there are no check items, use the Phase title as the default Subtask
	if (subtasks.length === 0) {
		subtasks.push({ index: 1, description: extractTag(block, "title"), completed: false })
	}
	return subtasks
}

function extractRequirement(source: string): string[] {
	const re = new RegExp(`<related_input_requirements>\\s*([\\s\\S]*?)\\s*</related_input_requirements>`, "i")
	const match = source.match(re)
	const requirements = match ? match[1].trim() : ""

	const lines = requirements.split(/\r?\n/)
	const relatedRequirements: string[] = []
	for (const rawLine of lines) {
		const line = rawLine.trim()
		relatedRequirements.push(line)
	}
	return relatedRequirements
}

export function parsePhase(raw: string): Phase[] {
	const phaseBlocks = raw.match(/<subtask>([\s\S]*?)<\/subtask>/gi) ?? []
	const phases: Phase[] = []

	console.log("[parsePhase] Found phaseBlocks:", phaseBlocks.length)

	for (const block of phaseBlocks) {
		const numberStr = extractTag("number", block)
		const title = extractTag("title", block)
		const exeOrderStr = extractTag("execution_order", block)
		const prerequisites = extractTagAsLines("prerequisites", block)

		// 공통 필드 초기화
		const phaseData: Partial<Phase> = {
			title,
			prerequisites,
			relatedRequirements: [],
			requirementCoverage: [],
			coreObjectives: [],
			functionalRequirements: [],
			deliverables: [],
			nonFunctionalRequirements: [],
			completionCriteria: [],
			handoffChecklist: [],
			integrationObjectives: [],
			integrationSteps: [],
			originalRequirementsValidations: [],
			systemWideTesting: [],
			finalDeliverables: [],
		}

		// FINAL 단계와 일반 단계에 따라 데이터 추출
		if (numberStr === "FINAL") {
			phaseData.integrationObjectives = extractTagAsLines("integration_objectives", block, true)
			phaseData.integrationSteps = extractTagAsLines("integration_steps", block, true)
			phaseData.originalRequirementsValidations = parseChecklist("original_requirements_validation", block)
			phaseData.systemWideTesting = extractTagAsLines("system_wide_testing", block, true)
			phaseData.finalDeliverables = parseChecklist("final_deliverables", block)
		} else {
			phaseData.relatedRequirements = extractRequirement(block)
			phaseData.requirementCoverage = extractTagAsLines("requirement_coverage", block)
			phaseData.coreObjectives = extractTagAsLines("core_objective", block)
			phaseData.functionalRequirements = extractTagAsLines("functional_requirements", block)
			phaseData.deliverables = extractTagAsLines("deliverables_for_next_phase", block)
			phaseData.nonFunctionalRequirements = extractTagAsLines("non_functional_requirements", block)
			phaseData.completionCriteria = parseChecklist("completion_criteria", block)
			phaseData.handoffChecklist = parseChecklist("handoff_checklist", block)
		}

		// Index calculation - simplify ternary operators
		const phaseIdx = numberStr
			? numberStr.toUpperCase() === "FINAL"
				? phaseBlocks.length
				: parseInt(numberStr, 10)
			: phases.length + 1 // If numberStr doesn't exist, use the next index

		const exeOrderIdx = exeOrderStr ? (exeOrderStr === "LAST" ? phaseBlocks.length : parseInt(exeOrderStr)) : phaseIdx // If exeOrderStr doesn't exist, set it to the same value as phaseIdx

		// Create and add completed Phase object
		phases.push({
			...phaseData,
			phaseIdx,
			exeOrderIdx,
		} as Phase)
	}

	// Sort by execution order
	return phases.sort((a, b) => a.exeOrderIdx - b.exeOrderIdx)
}

export function parsePlanFromOutput(raw: string): ParsedPlan {
	const projOverview = parseProjectOverview(raw)
	const executionPlan = parseExecutionPlan(raw)
	const requirements = parseRequirement(raw)
	const phases = parsePhase(raw)

	console.log("[parsePlanFromOutput] Parsed phases count:", phases.length)

	if (phases.length === 0) {
		console.error("[parsePlanFromOutput] No phases found in the Phase Plan content")
		console.log("[parsePlanFromOutput] Raw plan for debugging:", raw)
		throw new Error("No phases found in the Phase Plan content")
	}

	console.log("[parsePlanFromOutput] Successfully parsed plan with", phases.length, "phases")
	return { projOverview, executionPlan, requirements, phases }
}

// 새로운 함수: plan.txt 파일의 subtask 구조를 파싱
// export function parsePlanFromSubtaskFormat(raw: string): ParsedPlan {
// 	console.log("[parsePlanFromSubtaskFormat] Starting to parse plan content from subtask format")
// 	console.log("[parsePlanFromSubtaskFormat] Raw content length:", raw.length)

// 	// subtask 블록들을 찾기
// 	const subtaskRegex = /<subtask>([\s\S]*?)<\/subtask>/g
// 	const subtaskMatches = []
// 	let match

// 	while ((match = subtaskRegex.exec(raw)) !== null) {
// 		subtaskMatches.push(match[1])
// 	}

// 	console.log("[parsePlanFromSubtaskFormat] Found subtask blocks:", subtaskMatches.length)

// 	if (subtaskMatches.length === 0) {
// 		console.error("[parsePlanFromSubtaskFormat] No subtask blocks found")
// 		console.log("[parsePlanFromSubtaskFormat] Raw content first 1000 chars:", raw.substring(0, 1000))
// 		throw new Error("No subtask blocks found in the plan content")
// 	}

// 	// 각 subtask 블록을 Phase로 변환
// 	const phases: Phase[] = []

// 	subtaskMatches.forEach((subtaskContent, idx) => {
// 		console.log(`[parsePlanFromSubtaskFormat] Processing subtask ${idx + 1}:`)

// 		// number 추출
// 		const numberMatch = subtaskContent.match(/<number>(.*?)<\/number>/)
// 		const numberStr = numberMatch ? numberMatch[1].trim() : (idx + 1).toString()
// 		console.log(`[parsePlanFromSubtaskFormat] Found number: ${numberStr}`)

// 		// FINAL을 숫자로 변환
// 		const phaseIndex = numberStr === "FINAL" ? subtaskMatches.length : parseInt(numberStr)
// 		console.log(`[parsePlanFromSubtaskFormat] Phase index: ${phaseIndex}`)

// 		// title 추출
// 		const titleMatch = subtaskContent.match(/<title>(.*?)<\/title>/)
// 		const title = titleMatch ? titleMatch[1].trim() : `Phase ${phaseIndex}`
// 		console.log(`[parsePlanFromSubtaskFormat] Found title: ${title}`)

// 		// description을 전체 내용으로 설정 (나중에 필요시 더 세분화 가능)
// 		const description = subtaskContent.trim()

// 		phases.push({
// 			index: phaseIndex,
// 			phase_prompt: description,
// 			title: title,
// 			description: description,
// 			paths: [], // 빈 배열로 시작
// 			subtasks: [], // 빈 배열로 시작 (실행 중에 동적으로 생성)
// 			complete: false,
// 		})

// 		console.log(`[parsePlanFromSubtaskFormat] Successfully parsed phase ${phaseIndex}: ${title}`)
// 	})

// 	// index 기준으로 정렬
// 	phases.sort((a, b) => a.index - b.index)

// 	console.log("[parsePlanFromSubtaskFormat] Successfully parsed", phases.length, "phases")
// 	phases.forEach((phase) => {
// 		console.log(`[parsePlanFromSubtaskFormat] Phase ${phase.index}: ${phase.title}`)
// 	})

// 	return {
// 		rawPlan: raw,
// 		phases: phases,
// 	}
// }

// 새로운 함수: plan.txt 파일에서 고정된 플랜 로드

export async function parsePlanFromFixedFile(extensionContext: vscode.ExtensionContext): Promise<ParsedPlan> {
	console.log("[parsePlanFromFixedFile] Starting to load plan.txt file...")
	console.log("[parsePlanFromFixedFile] Extension URI:", extensionContext.extensionUri.toString())

	// 개발 환경에서 src 폴더를 먼저 시도
	try {
		const devPlanFileUri = vscode.Uri.joinPath(extensionContext.extensionUri, "src", "core", "assistant-message", "plan.txt")

		console.log("[parsePlanFromFixedFile] Trying dev path:", devPlanFileUri.toString())
		const planContentBytes = await vscode.workspace.fs.readFile(devPlanFileUri)
		const planContent = new TextDecoder().decode(planContentBytes)

		console.log("[parsePlanFromFixedFile] Successfully loaded plan.txt from dev path")
		console.log("[parsePlanFromFixedFile] Content length:", planContent.length)

		// 새로운 subtask 형식으로 파싱
		// return parsePlanFromSubtaskFormat(planContent)
		return parsePlanFromOutput(planContent)
	} catch (devError) {
		console.warn("[parsePlanFromFixedFile] Dev path failed:", devError)

		// 개발 환경에서 실패한 경우, 빌드된 extension 경로 시도
		try {
			const planFileUri = vscode.Uri.joinPath(
				extensionContext.extensionUri,
				"dist",
				"core",
				"assistant-message",
				"plan.txt",
			)

			console.log("[parsePlanFromFixedFile] Trying dist path:", planFileUri.toString())
			const planContentBytes = await vscode.workspace.fs.readFile(planFileUri)
			const planContent = new TextDecoder().decode(planContentBytes)

			console.log("[parsePlanFromFixedFile] Successfully loaded plan.txt from dist path")
			console.log("[parsePlanFromFixedFile] Content length:", planContent.length)

			// 새로운 subtask 형식으로 파싱
			// return parsePlanFromSubtaskFormat(planContent)
			return parsePlanFromOutput(planContent)
		} catch (distError) {
			console.error("[parsePlanFromFixedFile] Both paths failed")
			console.error("[parsePlanFromFixedFile] Dev error:", devError)
			console.error("[parsePlanFromFixedFile] Dist error:", distError)

			// 두 경로 모두 실패한 경우 기본 플랜 반환
			return {
				projOverview: "고정된 plan.txt 파일을 읽을 수 없습니다. Extension 빌드를 확인해주세요.",
				executionPlan: "고정된 plan.txt 파일을 읽을 수 없습니다. Extension 빌드를 확인해주세요.",
				requirements: {},
				phases: [],
			}
		}
	}
}

export class PhaseTracker {
	public phaseStates: PhaseState[] = []
	public currentPhaseIndex = 0
	private phaseChangeListeners: ((phaseId: number, newStatus: PhaseStatus) => void)[] = []

	constructor(
		public projOverview: string,
		public executionPlan: string,
		public requirements: RequirementInventory,

		private controller: Controller,
	) {
		// Step 1: Set up the first Phase (Plan) in Plan Mode
		this.phaseStates.push({
			index: 0,
			projOverview: projOverview,
			executionPlan: executionPlan,
			requirements: requirements,
			phase: {
				phaseIdx: 0,
				title: "Plan Phase",
				exeOrderIdx: 0,
			},
			status: PhaseStatus.Pending,
			startTime: Date.now(),
		})
	}

	// Called after the Plan phase is completed to populate the actual execution Phase list.
	public addPhasesFromPlan(parsedPhases: Phase[]): void {
		parsedPhases.forEach((p) => {
			this.phaseStates.push({
				index: p.phaseIdx,
				phase: p,
				status: PhaseStatus.Pending,
				startTime: Date.now(),
				endTime: undefined,
			})
		})
		this.saveCheckpoint().catch(() => {})
	}

	public markCurrentPhaseComplete(): void {
		const ps = this.phaseStates[this.currentPhaseIndex]
		this.completePhase(ps.index)
	}

	public completePhase(phaseId: number): void {
		const phaseState = this.phaseStates.find((p) => p.index === phaseId)
		if (!phaseState) {
			return
		}

		// Function to process all checklist items in batch
		const markChecklistDone = (subs?: Subtask[]) => {
			subs?.forEach((s) => (s.completed = true))
		}

		// Mark all checklist items as completed
		markChecklistDone(phaseState.phase?.completionCriteria)
		markChecklistDone(phaseState.phase?.handoffChecklist)

		// Handle additional checklists for the FINAL phase
		if (phaseState.phase?.originalRequirementsValidations || phaseState.phase?.finalDeliverables) {
			markChecklistDone(phaseState.phase.originalRequirementsValidations)
			markChecklistDone(phaseState.phase.finalDeliverables)
		}

		// Update status
		phaseState.status = PhaseStatus.Completed
		phaseState.endTime = Date.now()

		this.notifyPhaseChange(phaseId, PhaseStatus.Completed)
		this.saveCheckpoint()
	}

	public hasNextPhase(): boolean {
		return this.currentPhaseIndex < this.phaseStates.length - 1
	}

	public async moveToNextPhase(openNewTask: boolean = false): Promise<void> {
		this.currentPhaseIndex++
		const next = this.phaseStates[this.currentPhaseIndex]
		next.status = PhaseStatus.InProgress
		next.startTime = Date.now()

		this.notifyPhaseChange(next.index, PhaseStatus.InProgress)
		await this.controller.clearTask()
		if (openNewTask) {
			const nextPhase = this.phaseStates[this.currentPhaseIndex].phase
			let nextPhasePrompt = ""
			if (nextPhase) {
				nextPhasePrompt = buildPhasePrompt(nextPhase, this.totalPhases, this.getProjectOverview())
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

	public getPhaseByIdx(index: number): Phase {
		const p = this.phaseStates[index]
		if (!p || !p.phase) {
			throw new Error(`Phase ${index} is not properly initialized: missing phase data`)
		}
		return p.phase
	}

	public get totalPhases(): number {
		return this.phaseStates.length
	}

	public isAllComplete(): boolean {
		return this.phaseStates.every((p) => p.status === PhaseStatus.Completed || p.status === PhaseStatus.Skipped)
	}

	private notifyPhaseChange(id: number, status: PhaseStatus): void {
		this.phaseChangeListeners.forEach((l) => {
			try {
				l(id, status)
			} catch {}
		})
	}

	public getProjectOverview(): string {
		return this.projOverview
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
				projOverview: this.projOverview, // string
				executionPlan: this.executionPlan, // string
				requirements: this.requirements, // RequirementInventory
				phaseStates: this.phaseStates, // PhaseState[]
				currentPhaseIndex: this.currentPhaseIndex, // number
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
	public static async fromCheckpoint(controller: Controller): Promise<PhaseTracker | undefined> {
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
			const tracker = new PhaseTracker(
				checkpoint.projOverview,
				checkpoint.executionPlan,
				checkpoint.requirement,
				controller,
			)
			tracker.phaseStates = checkpoint.phaseStates
			tracker.currentPhaseIndex = checkpoint.currentPhaseIndex

			// Restored phase checkpoint
			return tracker
		} catch (err) {
			// No phase checkpoint to restore or failed
			return undefined
		}
	}
}

/**
 * Separates multi-line text into lines and returns them as a cleaned array.
 * - Removes empty lines.
 * - Trims whitespace from the beginning and end of each line.
 * - Optionally removes indentation or list markers (-, *, 1., etc.).
 */
function splitAndCleanLines(text: string, removeListMarkers: boolean = false): string[] {
	if (!text) {
		return []
	}

	// Split into lines
	const lines = text.split(/\r?\n/)
	const result: string[] = []

	for (let line of lines) {
		line = line.trim()

		if (!line) {
			continue
		}

		// Remove list markers (optional)
		if (removeListMarkers) {
			// Numbered list (1., 2., etc.)
			line = line.replace(/^\d+\.\s*/, "")
			// Bullet list (-, *, • etc.)
			line = line.replace(/^[-*•]\s*/, "")
		}

		result.push(line)
	}

	return result
}

/**
 * Extracts the content of a specific tag and returns it as an array of lines.
 */
function extractTagAsLines(tag: string, source: string, removeListMarkers: boolean = false): string[] {
	const content = extractTag(tag, source)
	return splitAndCleanLines(content, removeListMarkers)
}
