export const DIRECTION_STORAGE_KEY = "cline.webview.direction.v1"
export const DIRECTION_CHANGE_EVENT = "cline-webview-direction-change"

/**
 * `auto` follows the UI language, which is what most users want: a Persian or
 * Arabic system mirrors the webview without anyone hunting for a setting. `ltr`
 * and `rtl` pin the direction for people who run their editor in one language
 * but read Cline in another.
 */
export const APP_DIRECTIONS = ["auto", "ltr", "rtl"] as const

export type AppDirection = (typeof APP_DIRECTIONS)[number]

/** The direction actually applied to the document; `auto` always resolves. */
export type ResolvedDirection = "ltr" | "rtl"

export const DEFAULT_APP_DIRECTION: AppDirection = "auto"

/**
 * Primary language subtags whose scripts are written right to left. Matched on
 * the primary subtag only, so "fa-IR", "ar-EG", and "he" all qualify.
 */
export const RTL_LANGUAGE_TAGS = ["ar", "ckb", "dv", "fa", "he", "ku", "ps", "sd", "ug", "ur", "yi"] as const

export function isAppDirection(value: unknown): value is AppDirection {
	return typeof value === "string" && (APP_DIRECTIONS as readonly string[]).includes(value)
}

export function isRtlLanguageTag(tag: string): boolean {
	const [primary] = tag.trim().toLowerCase().split(/[-_]/)
	return (RTL_LANGUAGE_TAGS as readonly string[]).includes(primary)
}

export function resolveDirection(direction: AppDirection, languages: readonly string[]): ResolvedDirection {
	if (direction === "ltr" || direction === "rtl") {
		return direction
	}
	return languages.some(isRtlLanguageTag) ? "rtl" : "ltr"
}

function readPreferredLanguages(): readonly string[] {
	const languages = window.navigator?.languages
	if (Array.isArray(languages) && languages.length > 0) {
		return languages
	}
	const language = window.navigator?.language
	return language ? [language] : []
}

/**
 * Applies the resolved direction to <html>. Everything else reacts through
 * `dir`-scoped CSS, so this is the single mutation point. Called from main.tsx
 * before React mounts, which keeps the first paint direction-correct.
 */
export function applyDirection(direction: AppDirection): ResolvedDirection {
	const resolved = resolveDirection(direction, readPreferredLanguages())
	document.documentElement.dir = resolved
	document.documentElement.dataset.clineDirection = resolved
	window.dispatchEvent(
		new CustomEvent<ResolvedDirection>(DIRECTION_CHANGE_EVENT, {
			detail: resolved,
		}),
	)
	return resolved
}

export function readStoredDirection(): AppDirection {
	try {
		const stored = window.localStorage.getItem(DIRECTION_STORAGE_KEY)
		return isAppDirection(stored) ? stored : DEFAULT_APP_DIRECTION
	} catch {
		return DEFAULT_APP_DIRECTION
	}
}

export function syncDirection(): ResolvedDirection {
	return applyDirection(readStoredDirection())
}

export function setStoredDirection(direction: AppDirection): ResolvedDirection {
	try {
		window.localStorage.setItem(DIRECTION_STORAGE_KEY, direction)
	} catch {
		// Applying still works for this session when persistence is unavailable.
	}
	return applyDirection(direction)
}

export function readAppliedDirection(): ResolvedDirection {
	return document.documentElement.dir === "rtl" ? "rtl" : "ltr"
}

export function subscribeToDirection(onChange: (direction: ResolvedDirection) => void): () => void {
	const handleChange = (event: Event) => {
		if (event instanceof CustomEvent && (event.detail === "rtl" || event.detail === "ltr")) {
			onChange(event.detail)
		}
	}
	window.addEventListener(DIRECTION_CHANGE_EVENT, handleChange)
	return () => window.removeEventListener(DIRECTION_CHANGE_EVENT, handleChange)
}
