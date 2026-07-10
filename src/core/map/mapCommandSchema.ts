import { z } from "zod"

/**
 * Validates JSON command files dropped by Python MCP tools into
 * ~/.aihydro/map_commands/ before MapCommandWatcher acts on them (audit
 * finding E-9). This channel is local-only and unauthenticated by design —
 * any process running as the current user can write here — so schema
 * validation is defence-in-depth against malformed payloads (wrong types,
 * prototype-pollution-shaped keys, oversized strings), not an auth boundary.
 */
export const mapCommandSchema = z.object({
	type: z.string().min(1),
	layer_id: z.string().optional(),
	roi: z
		.object({
			id: z.string().optional(),
			name: z.string().optional(),
			source: z.string().optional(),
			geojson: z.string().optional(),
			area_ha: z.number().optional(),
			workspace_path: z.string().optional(),
		})
		.optional(),
	open_map: z.boolean().optional(),
	visible: z.boolean().optional(),
	display_name: z.string().optional(),
	clear_graduated: z.boolean().optional(),
	style: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
	metadata: z.record(z.string(), z.string()).optional(),
	basemap_id: z.string().optional(),
	basemap_name: z.string().optional(),
})

export type MapCommandPayload = z.infer<typeof mapCommandSchema>
