import type { Controller } from "@core/controller"
import { MapHydrologyService } from "./MapHydrologyService"
import { buildMeritMapLayer } from "./mapMessageHandler"
import {
	delineatePointPayloadSchema,
	gaugesInViewPayloadSchema,
	hucAtPointPayloadSchema,
	hydroCommandSchema,
	meritEnsureBasinPayloadSchema,
	meritEnsureRegionPayloadSchema,
	meritLayersPayloadSchema,
	searchHydrologyPayloadSchema,
	wbdLayersPayloadSchema,
} from "./schemas"

export async function handleHydroMapCommand(
	controller: Controller,
	message: unknown,
	postMessage: (response: Record<string, unknown>) => void | Promise<void> | Thenable<void>,
): Promise<void> {
	const parsed = hydroCommandSchema.safeParse(message)
	const requestId = (message as { requestId?: string })?.requestId ?? "unknown"
	if (!parsed.success) {
		await postMessage({
			type: "aihydro-hydro-result",
			requestId,
			ok: false,
			error: parsed.error.message,
		})
		return
	}

	const { command, payload } = parsed.data

	try {
		switch (command) {
			case "listPresets": {
				const result = await MapHydrologyService.listPresets()
				await postMessage({ type: "aihydro-hydro-result", requestId, ok: result.ok, result })
				break
			}
			case "meritEnsureBasin": {
				const p = meritEnsureBasinPayloadSchema.parse(payload ?? {})
				const result = await MapHydrologyService.meritEnsureBasin(p.lat, p.lon, p.download !== false)
				await postMessage({
					type: "aihydro-hydro-result",
					requestId,
					ok: result.ok,
					message: result.message,
					result,
				})
				break
			}
			case "meritEnsureRegion": {
				const p = meritEnsureRegionPayloadSchema.parse(payload ?? {})
				const result = await MapHydrologyService.meritEnsureRegion(p.preset, p.lat, p.lon, p.download !== false)
				await postMessage({
					type: "aihydro-hydro-result",
					requestId,
					ok: result.ok,
					message: result.message,
					result,
				})
				break
			}
			case "meritLayers": {
				const p = meritLayersPayloadSchema.parse(payload ?? {})
				const result = await MapHydrologyService.meritLayers({
					lat: p.lat,
					lon: p.lon,
					minLon: p.minLon,
					minLat: p.minLat,
					maxLon: p.maxLon,
					maxLat: p.maxLat,
					includeCatchments: p.includeCatchments,
					includeLevel2: p.includeLevel2,
				})
				if (result.ok && result.layers?.length) {
					for (const spec of result.layers) {
						controller.addMapLayer(buildMeritMapLayer(spec))
					}
				}
				await postMessage({
					type: "aihydro-hydro-result",
					requestId,
					ok: result.ok,
					message: result.message,
					result,
				})
				break
			}
			case "wbdLayers": {
				const p = wbdLayersPayloadSchema.parse(payload ?? {})
				const result = await MapHydrologyService.wbdLayers({
					lat: p.lat,
					lon: p.lon,
					minLon: p.minLon,
					minLat: p.minLat,
					maxLon: p.maxLon,
					maxLat: p.maxLat,
					hucLevel: p.hucLevel,
				})
				if (result.ok && result.layers?.length) {
					for (const spec of result.layers) {
						controller.addMapLayer(buildMeritMapLayer(spec))
					}
				}
				await postMessage({
					type: "aihydro-hydro-result",
					requestId,
					ok: result.ok,
					message: result.message,
					result,
				})
				break
			}
			case "hucAtPoint": {
				const p = hucAtPointPayloadSchema.parse(payload ?? {})
				const result = await MapHydrologyService.hucAtPoint({
					lat: p.lat,
					lon: p.lon,
					hucLevel: p.hucLevel,
				})
				await postMessage({
					type: "aihydro-hydro-result",
					requestId,
					ok: result.ok,
					message: result.message,
					result,
				})
				break
			}
			case "searchHydrology": {
				const p = searchHydrologyPayloadSchema.parse(payload ?? {})
				const result = await MapHydrologyService.searchHydrology({
					q: p.q,
					minLon: p.minLon,
					minLat: p.minLat,
					maxLon: p.maxLon,
					maxLat: p.maxLat,
					limit: p.limit,
				})
				await postMessage({
					type: "aihydro-hydro-result",
					requestId,
					ok: result.ok,
					message: result.message,
					result,
				})
				break
			}
			case "gaugesInView": {
				const p = gaugesInViewPayloadSchema.parse(payload ?? {})
				const result = await MapHydrologyService.gaugesInView({
					lat: p.lat,
					lon: p.lon,
					minLon: p.minLon,
					minLat: p.minLat,
					maxLon: p.maxLon,
					maxLat: p.maxLat,
					limit: p.limit,
				})
				if (result.ok && result.layers?.length) {
					for (const spec of result.layers) {
						controller.addMapLayer(buildMeritMapLayer(spec))
					}
				}
				await postMessage({
					type: "aihydro-hydro-result",
					requestId,
					ok: result.ok,
					message: result.message,
					result,
				})
				break
			}
			case "delineatePoint": {
				const p = delineatePointPayloadSchema.parse(payload ?? {})
				const result = await MapHydrologyService.delineatePoint({
					lat: p.lat,
					lon: p.lon,
					sessionId: p.sessionId,
					method: p.method,
					expectedAreaKm2: p.expectedAreaKm2,
					name: p.name,
				})
				// delineate_watershed_from_point pushes layers via ~/.aihydro/map_events
				await postMessage({
					type: "aihydro-hydro-result",
					requestId,
					ok: result.ok,
					message: result.message,
					result,
				})
				break
			}
			default:
				await postMessage({
					type: "aihydro-hydro-result",
					requestId,
					ok: false,
					error: `Unknown command: ${command}`,
				})
		}
	} catch (err) {
		await postMessage({
			type: "aihydro-hydro-result",
			requestId,
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		})
	}
}
