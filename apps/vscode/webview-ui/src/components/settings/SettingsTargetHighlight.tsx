import { useEffect } from "react"
import type { ResolvedSettingsTarget } from "./settingsTargets"

const HIGHLIGHT_FALLBACK_MS = 2200

interface SettingsTargetHighlightProps {
	requestId: number
	target: ResolvedSettingsTarget
	onComplete: (requestId: number) => void
}

const SettingsTargetHighlight = ({ requestId, target, onComplete }: SettingsTargetHighlightProps) => {
	const { elementId, focusElementId } = target
	useEffect(() => {
		if (!elementId) {
			onComplete(requestId)
			return
		}

		let highlightedElement: HTMLElement | undefined
		let fallbackTimer: ReturnType<typeof setTimeout> | undefined
		let finishHighlight: (() => void) | undefined
		let completed = false
		const frame = requestAnimationFrame(() => {
			const element = document.getElementById(elementId)
			if (!element) {
				onComplete(requestId)
				return
			}

			const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
			element.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" })
			document.getElementById(focusElementId ?? "")?.focus({ preventScroll: true })
			highlightedElement = element
			const handleAnimationEnd = () => {
				if (completed) {
					return
				}
				completed = true
				if (fallbackTimer !== undefined) {
					clearTimeout(fallbackTimer)
					fallbackTimer = undefined
				}
				element.classList.remove("settings-target-highlight")
				element.removeEventListener("animationend", handleAnimationEnd)
				highlightedElement = undefined
				onComplete(requestId)
			}
			finishHighlight = handleAnimationEnd
			element.addEventListener("animationend", handleAnimationEnd, { once: true })
			element.classList.add("settings-target-highlight")
			fallbackTimer = setTimeout(handleAnimationEnd, HIGHLIGHT_FALLBACK_MS)
		})

		return () => {
			cancelAnimationFrame(frame)
			if (fallbackTimer !== undefined) {
				clearTimeout(fallbackTimer)
			}
			if (highlightedElement) {
				highlightedElement.classList.remove("settings-target-highlight")
				if (finishHighlight) {
					highlightedElement.removeEventListener("animationend", finishHighlight)
				}
			}
		}
	}, [elementId, focusElementId, onComplete, requestId])

	return null
}

export default SettingsTargetHighlight
