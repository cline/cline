import { useCallback, useRef, useLayoutEffect, useState, useEffect } from "react"
import { detectPlatform, detectMetaKeyChar, unknown, NavigatorUAData } from "./platformDetection"

const usePlatformDetection = (customUserAgent?: string, customUserAgentData?: NavigatorUAData) => {
	const [platform, setPlatform] = useState<{ os: string; browser: string; version: string }>({
		os: unknown,
		browser: unknown,
		version: unknown,
	})

	const [metaKeyChar, setMetaKeyChar] = useState(unknown)

	useEffect(() => {
		const detectedPlatform = detectPlatform(customUserAgent, customUserAgentData)
		setPlatform(detectedPlatform)
		const detectedMetaKeyChar = detectMetaKeyChar(detectedPlatform.os)
		setMetaKeyChar(detectedMetaKeyChar)
	}, [customUserAgent, customUserAgentData])

	return [platform, metaKeyChar]
}

export { usePlatformDetection }

export const useShortcut = (shortcut: string, callback: any, options = { disableTextInputs: true }) => {
	const callbackRef = useRef(callback)
	const [keyCombo, setKeyCombo] = useState<string[]>([])

	useLayoutEffect(() => {
		callbackRef.current = callback
	})

	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			const isTextInput =
				event.target instanceof HTMLTextAreaElement ||
				(event.target instanceof HTMLInputElement && (!event.target.type || event.target.type === "text")) ||
				(event.target as HTMLElement).isContentEditable

			const modifierMap: { [key: string]: boolean } = {
				Control: event.ctrlKey,
				Alt: event.altKey,
				Meta: event.metaKey, // alias for Command
				Shift: event.shiftKey,
			}

			if (event.repeat) {
				return null
			}

			if (options.disableTextInputs && isTextInput) {
				return event.stopPropagation()
			}

			if (shortcut.includes("+")) {
				const keyArray = shortcut.split("+")

				if (Object.keys(modifierMap).includes(keyArray[0])) {
					const finalKey = keyArray.pop()

					if (keyArray.every((k) => modifierMap[k]) && finalKey === event.key) {
						return callbackRef.current(event)
					}
				} else {
					if (keyArray[keyCombo.length] === event.key) {
						if (keyArray[keyArray.length - 1] === event.key && keyCombo.length === keyArray.length - 1) {
							callbackRef.current(event)
							return setKeyCombo([])
						}

						return setKeyCombo((prevCombo) => [...prevCombo, event.key])
					}
					if (keyCombo.length > 0) {
						return setKeyCombo([])
					}
				}
			}

			if (shortcut === event.key) {
				return callbackRef.current(event)
			}
		},
		[keyCombo.length, options.disableTextInputs, shortcut],
	)

	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown)

		return () => {
			window.removeEventListener("keydown", handleKeyDown)
		}
	}, [handleKeyDown])
}
