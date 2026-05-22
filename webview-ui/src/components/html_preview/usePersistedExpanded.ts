import { useCallback, useState } from "react"

/**
 * Persists a boolean expand/collapse preference in localStorage (webview).
 * Defaults to expanded when no value is stored.
 */
export function usePersistedExpanded(storageKey: string, defaultExpanded = true): [boolean, () => void] {
	const [expanded, setExpanded] = useState(() => readStored(storageKey, defaultExpanded))

	const toggle = useCallback(() => {
		setExpanded((prev) => {
			const next = !prev
			try {
				localStorage.setItem(storageKey, String(next))
			} catch {
				// ignore quota / private mode
			}
			return next
		})
	}, [storageKey])

	return [expanded, toggle]
}

function readStored(storageKey: string, defaultExpanded: boolean): boolean {
	try {
		const v = localStorage.getItem(storageKey)
		if (v === null) {
			return defaultExpanded
		}
		return v === "true"
	} catch {
		return defaultExpanded
	}
}
