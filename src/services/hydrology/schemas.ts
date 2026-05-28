import { z } from "zod"

export const hydroCommandSchema = z.object({
	type: z.literal("aihydro-hydro-command"),
	requestId: z.string(),
	command: z.enum([
		"meritEnsureBasin",
		"meritEnsureBasinsRegion",
		"meritEnsureRegion",
		"meritLayers",
		"meritCatchmentLayers",
		"wbdLayers",
		"hucAtPoint",
		"searchHydrology",
		"gaugesInView",
		"damsInView",
		"delineatePoint",
		"listPresets",
	]),
	payload: z.record(z.unknown()).optional(),
})

export const meritEnsureBasinPayloadSchema = z.object({
	lat: z.number(),
	lon: z.number(),
	download: z.boolean().optional(),
})

export const meritEnsureRegionPayloadSchema = z.object({
	preset: z.string(),
	lat: z.number().optional(),
	lon: z.number().optional(),
	download: z.boolean().optional(),
})

export const meritEnsureBasinsRegionPayloadSchema = z.object({
	pfaf: z.string().optional(),
	lat: z.number().optional(),
	lon: z.number().optional(),
	download: z.boolean().optional(),
})

export const meritLayersPayloadSchema = z.object({
	lat: z.number(),
	lon: z.number(),
	minLon: z.number().optional(),
	minLat: z.number().optional(),
	maxLon: z.number().optional(),
	maxLat: z.number().optional(),
	includeCatchments: z.boolean().optional(),
	includeRivers: z.boolean().optional(),
	includeLevel2: z.boolean().optional(),
})

export const meritCatchmentLayersPayloadSchema = z.object({
	lat: z.number(),
	lon: z.number(),
	minLon: z.number().optional(),
	minLat: z.number().optional(),
	maxLon: z.number().optional(),
	maxLat: z.number().optional(),
	pfaf: z.string().optional(),
	download: z.boolean().optional(),
})

export const wbdLayersPayloadSchema = z.object({
	lat: z.number(),
	lon: z.number(),
	minLon: z.number().optional(),
	minLat: z.number().optional(),
	maxLon: z.number().optional(),
	maxLat: z.number().optional(),
	hucLevel: z.number().optional(),
})

export const hucAtPointPayloadSchema = z.object({
	lat: z.number(),
	lon: z.number(),
	hucLevel: z.number().optional(),
})

export const searchHydrologyPayloadSchema = z.object({
	q: z.string(),
	minLon: z.number().optional(),
	minLat: z.number().optional(),
	maxLon: z.number().optional(),
	maxLat: z.number().optional(),
	limit: z.number().optional(),
})

export const gaugesInViewPayloadSchema = z.object({
	lat: z.number(),
	lon: z.number(),
	minLon: z.number(),
	minLat: z.number(),
	maxLon: z.number(),
	maxLat: z.number(),
	limit: z.number().optional(),
})

export const damsInViewPayloadSchema = gaugesInViewPayloadSchema

export const delineatePointPayloadSchema = z.object({
	lat: z.number(),
	lon: z.number(),
	sessionId: z.string().optional(),
	method: z.string().optional(),
	expectedAreaKm2: z.number().optional(),
	name: z.string().optional(),
})
