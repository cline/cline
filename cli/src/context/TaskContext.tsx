/**
 * React Context for task state management in CLI
 * Provides access to ExtensionState and task controller
 */

import { registerPartialMessageCallback } from "@core/controller/ui/subscribeToPartialMessage"
import type { ClineMessage, ExtensionState } from "@shared/ExtensionMessage"
import { convertProtoToClineMessage } from "@shared/proto-conversions/cline-message"
import React, { createContext, ReactNode, useContext, useEffect, useRef, useState } from "react"

interface TaskContextType {
	state: Partial<ExtensionState>
	controller: any
	isComplete: boolean
	setIsComplete: (complete: boolean) => void
	lastError: string | null
	setLastError: (error: string | null) => void
	clearState: () => void
}

const TaskContext = createContext<TaskContextType | undefined>(undefined)

interface TaskContextProviderProps {
	controller: any
	children: ReactNode
}

export const TaskContextProvider: React.FC<TaskContextProviderProps> = ({ controller, children }) => {
	const [state, setState] = useState<Partial<ExtensionState>>(
		() =>
			({
				clineMessages: [],
				currentTaskItem: null,
			}) as unknown as Partial<ExtensionState>,
	)
	const [isComplete, setIsComplete] = useState(false)
	const [lastError, setLastError] = useState<string | null>(null)

	// Use ref to track latest state for partial message callback
	const stateRef = useRef(state)
	stateRef.current = state

	// Subscribe to controller state updates
	useEffect(() => {
		const originalPostState = controller.postStateToWebview.bind(controller)

		const handleStateUpdate = async () => {
			try {
				const newState = await controller.getStateToPostToWebview()
				// Ignore transient empty messages state during cancel/reinit
				// When clearTask() runs, messages briefly become [] before new task loads them
				const hadMessages = (stateRef.current.clineMessages?.length ?? 0) > 0
				const hasMessages = (newState.clineMessages?.length ?? 0) > 0
				if (hadMessages && !hasMessages) {
					return
				}
				setState(newState)
			} catch (error) {
				setLastError(error instanceof Error ? error.message : String(error))
			}
		}

		// Override postStateToWebview to update React state
		controller.postStateToWebview = async () => {
			await originalPostState()
			await handleStateUpdate()
		}

		// Subscribe to partial message events (for streaming updates)
		const unsubscribePartial = registerPartialMessageCallback((protoMessage) => {
			const updatedMessage = convertProtoToClineMessage(protoMessage) as ClineMessage
			setState((prevState) => {
				const messages = prevState.clineMessages || []
				// Find and update the message by timestamp
				const index = messages.findIndex((m) => m.ts === updatedMessage.ts)
				if (index >= 0) {
					const newMessages = [...messages]
					newMessages[index] = updatedMessage
					return { ...prevState, clineMessages: newMessages }
				}
				return prevState
			})
		})

		// Get initial state
		handleStateUpdate()

		// Cleanup
		return () => {
			controller.postStateToWebview = originalPostState
			unsubscribePartial()
		}
	}, [controller])

	// Force clear state (bypasses the empty messages check for intentional clears like /clear)
	const clearState = () => {
		setState({
			clineMessages: [],
			currentTaskItem: null,
		} as unknown as Partial<ExtensionState>)
	}

	const value: TaskContextType = {
		state,
		controller,
		isComplete,
		setIsComplete,
		lastError,
		setLastError,
		clearState,
	}

	return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>
}

/**
 * Hook to access task context
 */
export const useTaskContext = (): TaskContextType => {
	const context = useContext(TaskContext)
	if (!context) {
		throw new Error("useTaskContext must be used within TaskContextProvider")
	}
	return context
}

/**
 * Hook to access task state only
 */
export const useTaskState = (): Partial<ExtensionState> => {
	const { state } = useTaskContext()
	return state
}

/**
 * Hook to access controller
 */
export const useTaskController = () => {
	const { controller } = useTaskContext()
	return controller
}
