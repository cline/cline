import React, { useCallback, useRef, useMemo, useState, useEffect } from "react"
import { ClineMessage } from "../../../src/shared/ExtensionMessage"

/**
 * Custom hook to optimize state updates and prevent unnecessary re-renders
 */
export function useOptimizedMessages(messages: ClineMessage[]) {
	const messagesRef = useRef<ClineMessage[]>(messages)
	const lastUpdateRef = useRef<number>(Date.now())

	// Only update ref if messages actually changed
	const messagesChanged = useMemo(() => {
		if (messagesRef.current.length !== messages.length) {
			return true
		}

		// Check if last message changed (for partial updates)
		if (messages.length > 0) {
			const lastMessage = messages[messages.length - 1]
			const lastRefMessage = messagesRef.current[messages.length - 1]

			if (!lastRefMessage || lastMessage.ts !== lastRefMessage.ts || lastMessage.text !== lastRefMessage.text) {
				return true
			}
		}

		return false
	}, [messages])

	if (messagesChanged) {
		messagesRef.current = messages
		lastUpdateRef.current = Date.now()
	}

	// Return stable reference if messages haven't changed
	return messagesRef.current
}

/**
 * Debounced state update hook
 */
export function useDebouncedUpdate<T>(value: T, delay: number = 100): T {
	const [debouncedValue, setDebouncedValue] = useState<T>(value)
	const timeoutRef = useRef<NodeJS.Timeout>()

	useEffect(() => {
		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current)
		}

		timeoutRef.current = setTimeout(() => {
			setDebouncedValue(value)
		}, delay)

		return () => {
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current)
			}
		}
	}, [value, delay])

	return debouncedValue
}

/**
 * Memory-efficient message renderer
 */
export function useMessageRenderer(messages: ClineMessage[], windowSize: number = 50) {
	const visibleMessages = useMemo(() => {
		if (messages.length <= windowSize) {
			return messages
		}

		// Only render the last N messages
		return messages.slice(-windowSize)
	}, [messages, windowSize])

	const hasMoreMessages = messages.length > windowSize
	const hiddenCount = Math.max(0, messages.length - windowSize)

	return {
		visibleMessages,
		hasMoreMessages,
		hiddenCount,
		totalCount: messages.length,
	}
}

/**
 * Shallow compare hook for objects
 */
export function useShallowCompare<T extends Record<string, any>>(obj: T): T {
	const ref = useRef<T>(obj)

	const hasChanged = useMemo(() => {
		const keys1 = Object.keys(ref.current)
		const keys2 = Object.keys(obj)

		if (keys1.length !== keys2.length) {
			return true
		}

		for (const key of keys1) {
			if (ref.current[key] !== obj[key]) {
				return true
			}
		}

		return false
	}, [obj])

	if (hasChanged) {
		ref.current = obj
	}

	return ref.current
}

/**
 * Memory usage monitor hook
 */
export function useMemoryMonitor(threshold: number = 100) {
	const [memoryWarning, setMemoryWarning] = useState(false)

	useEffect(() => {
		// @ts-expect-error - performance.memory is a Chrome-specific API
		if (!performance.memory) {
			return
		}

		const checkMemory = () => {
			// @ts-expect-error - performance.memory is a Chrome-specific API
			const usedMemoryMB = performance.memory.usedJSHeapSize / (1024 * 1024)
			// @ts-expect-error - performance.memory is a Chrome-specific API
			const limitMB = performance.memory.jsHeapSizeLimit / (1024 * 1024)
			const percentUsed = (usedMemoryMB / limitMB) * 100

			if (percentUsed > threshold) {
				setMemoryWarning(true)
				console.warn(
					`Memory usage high: ${usedMemoryMB.toFixed(2)}MB / ${limitMB.toFixed(2)}MB (${percentUsed.toFixed(1)}%)`,
				)
			} else {
				setMemoryWarning(false)
			}
		}

		const interval = setInterval(checkMemory, 5000)
		checkMemory() // Check immediately

		return () => clearInterval(interval)
	}, [threshold])

	return memoryWarning
}
