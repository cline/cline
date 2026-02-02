/**
 * Main App component for Ink CLI
 * Routes between different views (task, history, config)
 */

import { Box } from "ink"
import React, { ReactNode, useCallback, useState } from "react"
import { StdinProvider } from "../context/StdinContext"
import { TaskContextProvider } from "../context/TaskContext"
import { useTerminalSize } from "../hooks/useTerminalSize"
import { AuthView } from "./AuthView"
import { ChatView } from "./ChatView"
import { ConfigView } from "./ConfigView"
import { HistoryView } from "./HistoryView"
import { TaskJsonView } from "./TaskJsonView"

export type ViewType = "task" | "history" | "config" | "auth" | "welcome"

interface HistoryPagination {
	page: number
	totalPages: number
	totalCount: number
	limit: number
}

interface HookInfo {
	name: string
	enabled: boolean
	absolutePath: string
}

interface WorkspaceHooks {
	workspaceName: string
	hooks: HookInfo[]
}

interface SkillInfo {
	name: string
	description: string
	path: string
	enabled: boolean
}

interface AppProps {
	view: ViewType
	taskId?: string
	controller?: any
	// Output Style
	verbose?: boolean
	jsonOutput?: boolean
	// Status Callbacks
	onComplete?: () => void
	onError?: () => void
	// For history view
	historyItems?: Array<{ id: string; ts: number; task?: string; totalCost?: number; modelId?: string }>
	historyAllItems?: Array<{ id: string; ts: number; task?: string; totalCost?: number; modelId?: string }>
	historyPagination?: HistoryPagination
	onHistoryPageChange?: (page: number) => void
	// For config view
	dataDir?: string
	globalState?: Record<string, any>
	workspaceState?: Record<string, any>
	// Rules toggles
	globalClineRulesToggles?: Record<string, boolean>
	localClineRulesToggles?: Record<string, boolean>
	localCursorRulesToggles?: Record<string, boolean>
	localWindsurfRulesToggles?: Record<string, boolean>
	localAgentsRulesToggles?: Record<string, boolean>
	onToggleRule?: (isGlobal: boolean, rulePath: string, enabled: boolean, ruleType: string) => void
	// Workflow toggles
	globalWorkflowToggles?: Record<string, boolean>
	localWorkflowToggles?: Record<string, boolean>
	onToggleWorkflow?: (isGlobal: boolean, workflowPath: string, enabled: boolean) => void
	// Hooks
	hooksEnabled?: boolean
	globalHooks?: HookInfo[]
	workspaceHooks?: WorkspaceHooks[]
	onToggleHook?: (isGlobal: boolean, hookName: string, enabled: boolean, workspaceName?: string) => void
	// Skills
	skillsEnabled?: boolean
	globalSkills?: SkillInfo[]
	localSkills?: SkillInfo[]
	onToggleSkill?: (isGlobal: boolean, skillPath: string, enabled: boolean) => void
	// For auth view
	authQuickSetup?: {
		provider?: string
		apikey?: string
		modelid?: string
		baseurl?: string
	}
	// For welcome view
	onWelcomeSubmit?: (prompt: string, imagePaths: string[]) => void
	onWelcomeExit?: () => void
	initialPrompt?: string
	initialImages?: string[]
	// Stdin support
	isRawModeSupported?: boolean
}

export const App: React.FC<AppProps> = ({
	view: initialView,
	taskId,
	verbose = false,
	jsonOutput = false,
	controller,
	onComplete,
	onError,
	historyItems = [],
	historyAllItems,
	historyPagination,
	onHistoryPageChange,
	dataDir = "",
	globalState = {},
	workspaceState = {},
	// Rules
	globalClineRulesToggles,
	localClineRulesToggles,
	localCursorRulesToggles,
	localWindsurfRulesToggles,
	localAgentsRulesToggles,
	onToggleRule,
	// Workflows
	globalWorkflowToggles,
	localWorkflowToggles,
	onToggleWorkflow,
	// Hooks
	hooksEnabled,
	globalHooks,
	workspaceHooks,
	onToggleHook,
	// Skills
	skillsEnabled,
	globalSkills,
	localSkills,
	onToggleSkill,
	authQuickSetup,
	onWelcomeSubmit,
	onWelcomeExit,
	initialPrompt,
	initialImages,
	isRawModeSupported = true,
}) => {
	const { resizeKey } = useTerminalSize()
	const [currentView, setCurrentView] = useState<ViewType>(initialView)
	const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(taskId)

	const handleSelectTask = useCallback((taskId: string) => {
		setSelectedTaskId(taskId)
		setCurrentView("task")
	}, [])

	const handleNavigateToWelcome = useCallback(() => {
		setCurrentView("welcome")
	}, [])

	// Handle welcome submit when navigating internally (e.g., from auth -> welcome)
	const _handleInternalWelcomeSubmit = useCallback(
		async (prompt: string, imagePaths: string[]) => {
			if (onWelcomeSubmit) {
				// If external handler provided, use it
				onWelcomeSubmit(prompt, imagePaths)
			} else if (controller && prompt.trim()) {
				// Otherwise, start a task directly via controller
				setCurrentView("task")
				// Convert image paths to data URLs if needed
				const imageDataUrls =
					imagePaths.length > 0
						? await Promise.all(
								imagePaths.map(async (p) => {
									try {
										const fs = await import("fs/promises")
										const path = await import("path")
										const data = await fs.readFile(p)
										const ext = path.extname(p).toLowerCase().slice(1)
										const mimeType = ext === "jpg" ? "jpeg" : ext
										return `data:image/${mimeType};base64,${data.toString("base64")}`
									} catch {
										return null
									}
								}),
							)
						: []
				const validImages = imageDataUrls.filter((img): img is string => img !== null)
				await controller.initTask(prompt.trim(), validImages.length > 0 ? validImages : undefined)
			}
		},
		[onWelcomeSubmit, controller],
	)

	let content: ReactNode

	switch (currentView) {
		case "history":
			content = (
				<HistoryView
					allItems={historyAllItems}
					controller={controller}
					items={historyItems}
					onPageChange={onHistoryPageChange}
					onSelectTask={handleSelectTask}
					pagination={historyPagination}
				/>
			)
			break

		case "config":
			content = (
				<ConfigView
					dataDir={dataDir}
					globalClineRulesToggles={globalClineRulesToggles}
					globalHooks={globalHooks}
					globalSkills={globalSkills}
					globalState={globalState}
					globalWorkflowToggles={globalWorkflowToggles}
					hooksEnabled={hooksEnabled}
					localAgentsRulesToggles={localAgentsRulesToggles}
					localClineRulesToggles={localClineRulesToggles}
					localCursorRulesToggles={localCursorRulesToggles}
					localSkills={localSkills}
					localWindsurfRulesToggles={localWindsurfRulesToggles}
					localWorkflowToggles={localWorkflowToggles}
					onToggleHook={onToggleHook}
					onToggleRule={onToggleRule}
					onToggleSkill={onToggleSkill}
					onToggleWorkflow={onToggleWorkflow}
					skillsEnabled={skillsEnabled}
					workspaceHooks={workspaceHooks}
					workspaceState={workspaceState}
				/>
			)
			break

		case "auth":
			content = (
				<AuthView
					controller={controller}
					onComplete={onComplete}
					onError={onError}
					onNavigateToWelcome={handleNavigateToWelcome}
					quickSetup={authQuickSetup}
				/>
			)
			break

		case "task":
		case "welcome":
			content = (
				<TaskContextProvider controller={controller}>
					{jsonOutput ? (
						<TaskJsonView onComplete={onComplete} onError={onError} taskId={selectedTaskId} verbose={verbose} />
					) : (
						<ChatView
							controller={controller}
							initialImages={initialImages}
							initialPrompt={initialPrompt}
							onComplete={onComplete}
							onError={onError}
							onExit={onWelcomeExit}
							taskId={selectedTaskId}
						/>
					)}
				</TaskContextProvider>
			)
			break

		default:
			content = null
	}

	return (
		<StdinProvider isRawModeSupported={isRawModeSupported}>
			<Box key={resizeKey}>{content}</Box>
		</StdinProvider>
	)
}
