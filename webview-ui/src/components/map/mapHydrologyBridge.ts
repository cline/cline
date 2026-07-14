import { PLATFORM_CONFIG } from "../../config/platform.config"

export type HydroMapCommand =
	| "meritEnsureBasin"
	| "meritEnsureBasinsRegion"
	| "meritEnsureRegion"
	| "meritLayers"
	| "meritCatchmentLayers"
	| "wbdLayers"
	| "hucAtPoint"
	| "searchHydrology"
	| "gaugesInView"
	| "damsInView"
	| "delineatePoint"
	| "listPresets"

export interface HydroCommandPayload {
	lat?: number
	lon?: number
	preset?: string
	pfaf?: string
	download?: boolean
	minLon?: number
	minLat?: number
	maxLon?: number
	maxLat?: number
	includeCatchments?: boolean
	includeRivers?: boolean
	hucLevel?: number
	q?: string
	limit?: number
	sessionId?: string
	method?: string
	expectedAreaKm2?: number
	name?: string
	includeLevel2?: boolean
}

export interface HydroCommandResult {
	ok: boolean
	message?: string
	error?: string
	result?: Record<string, unknown>
}

function newRequestId(): string {
	return `hydro-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function sendHydroMapCommand(command: HydroMapCommand, payload?: HydroCommandPayload): Promise<HydroCommandResult> {
	const requestId = newRequestId()
	return new Promise((resolve) => {
		const timeoutMs =
			command === "delineatePoint"
				? 1_200_000
				: command === "searchHydrology" || command === "hucAtPoint"
					? 90_000
					: 900_000
		const timeout = window.setTimeout(() => {
			window.removeEventListener("message", onMessage)
			resolve({ ok: false, error: "Hydro command timed out" })
		}, timeoutMs)

		const onMessage = (event: MessageEvent) => {
			const data = event.data
			if (!data || data.type !== "aihydro-hydro-result" || data.requestId !== requestId) {
				return
			}
			window.clearTimeout(timeout)
			window.removeEventListener("message", onMessage)
			resolve({
				ok: Boolean(data.ok),
				message: data.message,
				error: data.error,
				result: data.result,
			})
		}
		window.addEventListener("message", onMessage)
		PLATFORM_CONFIG.postMessage({
			type: "aihydro-hydro-command",
			requestId,
			command,
			payload: payload ?? {},
		})
	})
}
