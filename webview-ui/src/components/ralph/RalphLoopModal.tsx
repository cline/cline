/**
 * RalphLoopModal - Configuration modal for starting a Ralph Wiggum loop.
 *
 * Provides a GUI-first experience for:
 * - Defining the task/goal
 * - Planning the workflow iteratively
 * - Configuring loop parameters
 * - Enabling/disabling beads (checkpoints)
 */

import { VSCodeButton, VSCodeCheckbox, VSCodeTextArea, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import {
	ChevronLeftIcon,
	ChevronRightIcon,
	CirclePlayIcon,
	ClipboardListIcon,
	CogIcon,
	ListChecksIcon,
	PlayIcon,
	XIcon,
} from "lucide-react"
import { memo, useCallback, useEffect, useRef, useState } from "react"
import { useClickAway } from "react-use"
import { cn } from "@/lib/utils"

interface RalphLoopConfig {
	taskDescription: string
	maxIterations: number
	completionPromise: string
	beadsEnabled: boolean
	testCommand: string
	typeCheckCommand: string
	lintCommand: string
}

interface PlanStep {
	id: string
	description: string
	completed: boolean
}

interface RalphLoopModalProps {
	isVisible: boolean
	onClose: () => void
	onStart: (config: RalphLoopConfig, plan: PlanStep[]) => void
}

const DEFAULT_CONFIG: RalphLoopConfig = {
	taskDescription: "",
	maxIterations: 50,
	completionPromise: "COMPLETE",
	beadsEnabled: false,
	testCommand: "",
	typeCheckCommand: "",
	lintCommand: "",
}

type ModalStep = "task" | "plan" | "config" | "review"

const RalphLoopModal = memo(({ isVisible, onClose, onStart }: RalphLoopModalProps) => {
	const modalRef = useRef<HTMLDivElement>(null)
	const [currentStep, setCurrentStep] = useState<ModalStep>("task")
	const [config, setConfig] = useState<RalphLoopConfig>(DEFAULT_CONFIG)
	const [plan, setPlan] = useState<PlanStep[]>([])
	const [newStepText, setNewStepText] = useState("")

	// Click away to close
	useClickAway(modalRef, () => {
		if (isVisible) {
			onClose()
		}
	})

	// Reset state when modal opens
	useEffect(() => {
		if (isVisible) {
			setCurrentStep("task")
			setConfig(DEFAULT_CONFIG)
			setPlan([])
			setNewStepText("")
		}
	}, [isVisible])

	// Handle escape key
	useEffect(() => {
		const handleEscape = (e: KeyboardEvent) => {
			if (e.key === "Escape" && isVisible) {
				onClose()
			}
		}
		window.addEventListener("keydown", handleEscape)
		return () => window.removeEventListener("keydown", handleEscape)
	}, [isVisible, onClose])

	const handleAddPlanStep = useCallback(() => {
		if (newStepText.trim()) {
			setPlan((prev) => [
				...prev,
				{
					id: crypto.randomUUID(),
					description: newStepText.trim(),
					completed: false,
				},
			])
			setNewStepText("")
		}
	}, [newStepText])

	const handleRemovePlanStep = useCallback((id: string) => {
		setPlan((prev) => prev.filter((step) => step.id !== id))
	}, [])

	const handleTogglePlanStep = useCallback((id: string) => {
		setPlan((prev) => prev.map((step) => (step.id === id ? { ...step, completed: !step.completed } : step)))
	}, [])

	const handleStart = useCallback(() => {
		onStart(config, plan)
		onClose()
	}, [config, plan, onStart, onClose])

	const canProceedFromTask = config.taskDescription.trim().length > 10
	const canProceedFromPlan = plan.length > 0
	const canStart = canProceedFromTask

	if (!isVisible) {
		return null
	}

	const steps: { key: ModalStep; label: string; icon: React.ReactNode }[] = [
		{ key: "task", label: "Task", icon: <ClipboardListIcon className="size-3" /> },
		{ key: "plan", label: "Plan", icon: <ListChecksIcon className="size-3" /> },
		{ key: "config", label: "Config", icon: <CogIcon className="size-3" /> },
		{ key: "review", label: "Review", icon: <PlayIcon className="size-3" /> },
	]

	const currentStepIndex = steps.findIndex((s) => s.key === currentStep)

	return (
		<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
			<div
				className="bg-editor-background border border-editor-group-border rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden"
				ref={modalRef}>
				{/* Header */}
				<div className="flex items-center justify-between px-4 py-3 border-b border-editor-group-border">
					<div className="flex items-center gap-2">
						<CirclePlayIcon className="size-4 text-link" />
						<span className="font-semibold text-lg">Start Ralph Loop</span>
					</div>
					<button className="p-1 rounded hover:bg-list-hover-background transition-colors" onClick={onClose}>
						<XIcon className="size-4" />
					</button>
				</div>

				{/* Step Indicators */}
				<div className="flex items-center justify-center gap-2 px-4 py-3 border-b border-editor-group-border bg-code">
					{steps.map((step, index) => (
						<div className="flex items-center" key={step.key}>
							<button
								className={cn(
									"flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors",
									currentStep === step.key
										? "bg-link text-link-foreground"
										: index < currentStepIndex
											? "bg-success/20 text-success hover:bg-success/30"
											: "bg-list-hover-background text-muted-foreground hover:bg-list-active-selection-background",
								)}
								onClick={() => setCurrentStep(step.key)}>
								{step.icon}
								{step.label}
							</button>
							{index < steps.length - 1 && <ChevronRightIcon className="size-3 mx-1 text-muted-foreground" />}
						</div>
					))}
				</div>

				{/* Content */}
				<div className="flex-1 overflow-y-auto p-4">
					{currentStep === "task" && (
						<div className="space-y-4">
							<div>
								<label className="block text-sm font-medium mb-2">What do you want to accomplish?</label>
								<VSCodeTextArea
									className="w-full"
									onInput={(e) =>
										setConfig((prev) => ({
											...prev,
											taskDescription: (e.target as HTMLTextAreaElement).value,
										}))
									}
									placeholder="Describe your task in detail. Be specific about what success looks like..."
									rows={6}
									value={config.taskDescription}
								/>
								<p className="text-xs text-muted-foreground mt-1">
									The more detailed your description, the better the AI can help plan and execute.
								</p>
							</div>

							<div className="bg-quote rounded-sm p-3">
								<h4 className="font-medium text-sm mb-2">Tips for effective tasks:</h4>
								<ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
									<li>Be specific about the end goal</li>
									<li>Mention any constraints or requirements</li>
									<li>Include acceptance criteria if known</li>
									<li>Reference relevant files or areas of the codebase</li>
								</ul>
							</div>
						</div>
					)}

					{currentStep === "plan" && (
						<div className="space-y-4">
							<div>
								<label className="block text-sm font-medium mb-2">
									Break down your task into steps (optional)
								</label>
								<p className="text-xs text-muted-foreground mb-3">
									Define the steps you expect the AI to take. This helps track progress and ensures nothing is
									missed.
								</p>

								{/* Existing steps */}
								<div className="space-y-2 mb-4">
									{plan.map((step, index) => (
										<div
											className="flex items-center gap-2 p-2 bg-code rounded-sm border border-editor-group-border"
											key={step.id}>
											<span className="text-xs text-muted-foreground w-6">{index + 1}.</span>
											<span className={cn("flex-1 text-sm", step.completed && "line-through opacity-50")}>
												{step.description}
											</span>
											<button
												className="p-1 rounded hover:bg-error/20 text-error transition-colors"
												onClick={() => handleRemovePlanStep(step.id)}>
												<XIcon className="size-3" />
											</button>
										</div>
									))}
								</div>

								{/* Add new step */}
								<div className="flex gap-2">
									<VSCodeTextField
										className="flex-1"
										onInput={(e) => setNewStepText((e.target as HTMLInputElement).value)}
										onKeyDown={(e) => {
											if (e.key === "Enter") {
												handleAddPlanStep()
											}
										}}
										placeholder="Add a step..."
										value={newStepText}
									/>
									<VSCodeButton disabled={!newStepText.trim()} onClick={handleAddPlanStep}>
										Add
									</VSCodeButton>
								</div>
							</div>

							{plan.length === 0 && (
								<div className="bg-warning/10 border border-warning/30 rounded-sm p-3">
									<p className="text-sm text-warning">
										No plan steps defined. The AI will determine its own approach based on your task
										description.
									</p>
								</div>
							)}
						</div>
					)}

					{currentStep === "config" && (
						<div className="space-y-4">
							<div className="grid grid-cols-2 gap-4">
								<div>
									<label className="block text-sm font-medium mb-2">Max Iterations</label>
									<VSCodeTextField
										className="w-full"
										onInput={(e) => {
											const value = (e.target as HTMLInputElement).value.replace(/\D/g, "")
											setConfig((prev) => ({
												...prev,
												maxIterations: parseInt(value) || 50,
											}))
										}}
										value={config.maxIterations.toString()}
									/>
									<p className="text-xs text-muted-foreground mt-1">
										Maximum loops before stopping (default: 50)
									</p>
								</div>

								<div>
									<label className="block text-sm font-medium mb-2">Completion Signal</label>
									<VSCodeTextField
										className="w-full"
										onInput={(e) =>
											setConfig((prev) => ({
												...prev,
												completionPromise: (e.target as HTMLInputElement).value,
											}))
										}
										placeholder="COMPLETE"
										value={config.completionPromise}
									/>
									<p className="text-xs text-muted-foreground mt-1">String that signals task completion</p>
								</div>
							</div>

							<div className="border-t border-editor-group-border pt-4">
								<h4 className="font-medium text-sm mb-3">Backpressure Commands (optional)</h4>
								<p className="text-xs text-muted-foreground mb-3">
									If any of these fail, the loop continues until they pass.
								</p>

								<div className="space-y-3">
									<div>
										<label className="block text-xs font-medium mb-1">Test Command</label>
										<VSCodeTextField
											className="w-full"
											onInput={(e) =>
												setConfig((prev) => ({
													...prev,
													testCommand: (e.target as HTMLInputElement).value,
												}))
											}
											placeholder="npm test"
											value={config.testCommand}
										/>
									</div>

									<div>
										<label className="block text-xs font-medium mb-1">Type Check Command</label>
										<VSCodeTextField
											className="w-full"
											onInput={(e) =>
												setConfig((prev) => ({
													...prev,
													typeCheckCommand: (e.target as HTMLInputElement).value,
												}))
											}
											placeholder="npm run check-types"
											value={config.typeCheckCommand}
										/>
									</div>

									<div>
										<label className="block text-xs font-medium mb-1">Lint Command</label>
										<VSCodeTextField
											className="w-full"
											onInput={(e) =>
												setConfig((prev) => ({
													...prev,
													lintCommand: (e.target as HTMLInputElement).value,
												}))
											}
											placeholder="npm run lint"
											value={config.lintCommand}
										/>
									</div>
								</div>
							</div>

							<div className="border-t border-editor-group-border pt-4">
								<div className="flex items-start gap-3">
									<VSCodeCheckbox
										checked={config.beadsEnabled}
										onChange={(e) =>
											setConfig((prev) => ({
												...prev,
												beadsEnabled: (e.target as HTMLInputElement).checked,
											}))
										}
									/>
									<div>
										<label className="text-sm font-medium">Enable Beads (Checkpoints)</label>
										<p className="text-xs text-muted-foreground mt-0.5">
											Create reviewable checkpoints at each iteration. You can approve or reject changes
											before they're applied.
										</p>
									</div>
								</div>
							</div>
						</div>
					)}

					{currentStep === "review" && (
						<div className="space-y-4">
							<div className="bg-code rounded-sm p-4 border border-editor-group-border">
								<h4 className="font-medium text-sm mb-2">Task</h4>
								<p className="text-sm text-muted-foreground whitespace-pre-wrap">
									{config.taskDescription || "No task description provided"}
								</p>
							</div>

							{plan.length > 0 && (
								<div className="bg-code rounded-sm p-4 border border-editor-group-border">
									<h4 className="font-medium text-sm mb-2">Plan ({plan.length} steps)</h4>
									<ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
										{plan.map((step) => (
											<li key={step.id}>{step.description}</li>
										))}
									</ol>
								</div>
							)}

							<div className="bg-code rounded-sm p-4 border border-editor-group-border">
								<h4 className="font-medium text-sm mb-2">Configuration</h4>
								<dl className="text-sm space-y-1">
									<div className="flex justify-between">
										<dt className="text-muted-foreground">Max Iterations:</dt>
										<dd>{config.maxIterations}</dd>
									</div>
									<div className="flex justify-between">
										<dt className="text-muted-foreground">Completion Signal:</dt>
										<dd>
											<code className="bg-quote px-1 rounded">{config.completionPromise}</code>
										</dd>
									</div>
									<div className="flex justify-between">
										<dt className="text-muted-foreground">Beads Enabled:</dt>
										<dd>{config.beadsEnabled ? "Yes" : "No"}</dd>
									</div>
									{config.testCommand && (
										<div className="flex justify-between">
											<dt className="text-muted-foreground">Test Command:</dt>
											<dd>
												<code className="bg-quote px-1 rounded text-xs">{config.testCommand}</code>
											</dd>
										</div>
									)}
								</dl>
							</div>

							<div className="bg-link/10 border border-link/30 rounded-sm p-3">
								<p className="text-sm">
									Ready to start? The loop will run until the AI signals completion or reaches the maximum
									iterations.
								</p>
							</div>
						</div>
					)}
				</div>

				{/* Footer */}
				<div className="flex items-center justify-between px-4 py-3 border-t border-editor-group-border bg-code">
					<div>
						{currentStepIndex > 0 && (
							<VSCodeButton appearance="secondary" onClick={() => setCurrentStep(steps[currentStepIndex - 1].key)}>
								<ChevronLeftIcon className="size-3 mr-1" />
								Back
							</VSCodeButton>
						)}
					</div>

					<div className="flex items-center gap-2">
						<VSCodeButton appearance="secondary" onClick={onClose}>
							Cancel
						</VSCodeButton>

						{currentStepIndex < steps.length - 1 ? (
							<VSCodeButton
								disabled={currentStep === "task" && !canProceedFromTask}
								onClick={() => setCurrentStep(steps[currentStepIndex + 1].key)}>
								Next
								<ChevronRightIcon className="size-3 ml-1" />
							</VSCodeButton>
						) : (
							<VSCodeButton disabled={!canStart} onClick={handleStart}>
								<PlayIcon className="size-3 mr-1" />
								Start Loop
							</VSCodeButton>
						)}
					</div>
				</div>
			</div>
		</div>
	)
})

RalphLoopModal.displayName = "RalphLoopModal"

export default RalphLoopModal
export type { RalphLoopConfig, PlanStep }
