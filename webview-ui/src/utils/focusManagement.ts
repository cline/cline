import { RefObject, useEffect, useRef } from "react"
import { getFocusableElements } from "./interactiveProps"

export { getFocusableElements } from "./interactiveProps"

export function useFocusTrap(isActive: boolean, containerRef: RefObject<HTMLElement>): void {
	useEffect(() => {
		if (!isActive || !containerRef.current) {
			return
		}

		const container = containerRef.current

		const handleTabKey = (e: KeyboardEvent): void => {
			if (e.key !== "Tab") {
				return
			}

			const focusableElements = getFocusableElements(container, true)
			if (focusableElements.length === 0) {
				e.preventDefault()
				return
			}

			const firstElement = focusableElements[0]
			const lastElement = focusableElements[focusableElements.length - 1]

			if (e.shiftKey) {
				if (document.activeElement === firstElement || !container.contains(document.activeElement)) {
					e.preventDefault()
					lastElement.focus()
				}
			} else {
				if (document.activeElement === lastElement || !container.contains(document.activeElement)) {
					e.preventDefault()
					firstElement.focus()
				}
			}
		}

		const focusableElements = getFocusableElements(container, true)
		if (focusableElements.length > 0 && !container.contains(document.activeElement)) {
			focusableElements[0].focus()
		}

		document.addEventListener("keydown", handleTabKey)
		return () => document.removeEventListener("keydown", handleTabKey)
	}, [isActive, containerRef])
}

export function useFocusRestoration(restoreTargetRef: RefObject<HTMLElement>): void {
	const previousActiveElementRef = useRef<HTMLElement | null>(null)

	useEffect(() => {
		previousActiveElementRef.current = document.activeElement as HTMLElement

		return () => {
			if (restoreTargetRef.current) {
				restoreTargetRef.current.focus()
			} else if (previousActiveElementRef.current && document.contains(previousActiveElementRef.current)) {
				previousActiveElementRef.current.focus()
			}
		}
	}, [restoreTargetRef])
}

export function useModal<TriggerElement extends HTMLElement = HTMLElement, ContainerElement extends HTMLElement = HTMLElement>(
	isOpen: boolean,
	onClose: () => void,
	externalTriggerRef?: RefObject<TriggerElement>,
) {
	const internalTriggerRef = useRef<TriggerElement>(null)
	const containerRef = useRef<ContainerElement>(null)
	const triggerRef = externalTriggerRef || internalTriggerRef

	useFocusTrap(isOpen, containerRef)
	useFocusRestoration(triggerRef)

	useEffect(() => {
		if (!isOpen) {
			return
		}

		const handleEscape = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault()
				onClose()
			}
		}

		window.addEventListener("keydown", handleEscape)
		return () => window.removeEventListener("keydown", handleEscape)
	}, [isOpen, onClose])

	return { triggerRef, containerRef }
}
