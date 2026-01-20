/**
 * Main App component for Ink CLI
 * Routes between different views (task, history, config)
 */

import { Box } from "ink"
import React, { ReactNode, useCallback, useState } from "react"
import { TaskContextProvider } from "../context/TaskContext"
import { AuthView } from "./AuthView"
import { ConfigView } from "./ConfigView"
import { HistoryView } from "./HistoryView"
import { TaskView } from "./TaskView"
import { WelcomeView } from "./WelcomeView"

export type ViewType = "task" | "history" | "config" | "auth" | "welcome"

interface HistoryPagination {
	page: number
	totalPages: number
	totalCount: number
	limit: number
}

interface AppProps {
	view: ViewType
	taskId?: string
	verbose?: boolean
	controller?: any
	onComplete?: () => void
	onError?: () => void
	// For history view
	historyItems?: Array<{ id: string; ts: number; task?: string; totalCost?: number; modelId?: string }>
	historyPagination?: HistoryPagination
	// For config view
	dataDir?: string
	globalState?: Record<string, any>
	workspaceState?: Record<string, any>
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
}

export const App: React.FC<AppProps> = ({
	view: initialView,
	taskId,
	verbose = false,
	controller,
	onComplete,
	onError,
	historyItems = [],
	historyPagination,
	dataDir = "",
	globalState = {},
	workspaceState = {},
	authQuickSetup,
	onWelcomeSubmit,
	onWelcomeExit,
}) => {
	const [currentView, setCurrentView] = useState<ViewType>(initialView)
	const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(taskId)

	const handleSelectTask = useCallback((taskId: string) => {
		setSelectedTaskId(taskId)
		setCurrentView("task")
	}, [])

	let content: ReactNode

	switch (currentView) {
		case "task":
			content = (
				<TaskContextProvider controller={controller}>
					<TaskView onComplete={onComplete} onError={onError} taskId={selectedTaskId} verbose={verbose} />
				</TaskContextProvider>
			)
			break

		case "history":
			content = (
				<HistoryView
					controller={controller}
					items={historyItems}
					onSelectTask={handleSelectTask}
					pagination={historyPagination}
				/>
			)
			break

		case "config":
			content = <ConfigView dataDir={dataDir} globalState={globalState} workspaceState={workspaceState} />
			break

		case "auth":
			content = <AuthView controller={controller} onComplete={onComplete} onError={onError} quickSetup={authQuickSetup} />
			break

		case "welcome":
			content = <WelcomeView controller={controller} onExit={onWelcomeExit} onSubmit={onWelcomeSubmit || (() => {})} />
			break

		default:
			content = null
	}

	return <Box>{content}</Box>
}
