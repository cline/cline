/**
 * MapCommandWatcher — polls ~/.aihydro/map_commands/ for commands from Python MCP tools.
 */

import type { Controller } from "@core/controller"
import type { MapLayerPatch } from "@core/map/mergeMapLayerPatch"
import { MapRoi } from "@shared/proto/cline/map"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { type MapCommandPayload, mapCommandSchema } from "./mapCommandSchema"

const MAP_COMMANDS_DIR = path.join(os.homedir(), ".aihydro", "map_commands")
const POLL_INTERVAL_MS = 250

export class MapCommandWatcher {
	private intervalId: NodeJS.Timeout | null = null
	private processing = false

	constructor(private readonly controller: Controller) {}

	start(): void {
		if (this.intervalId) {
			return
		}
		void fs.mkdir(MAP_COMMANDS_DIR, { recursive: true })
		this.intervalId = setInterval(() => void this.poll(), POLL_INTERVAL_MS)
		console.log("[MapCommandWatcher] Started polling", MAP_COMMANDS_DIR)
	}

	stop(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId)
			this.intervalId = null
		}
	}

	private async poll(): Promise<void> {
		if (this.processing) {
			return
		}
		this.processing = true
		try {
			const entries = await fs.readdir(MAP_COMMANDS_DIR)
			const jsonFiles = entries.filter((e) => e.endsWith(".json")).sort()
			for (const file of jsonFiles) {
				const filePath = path.join(MAP_COMMANDS_DIR, file)
				try {
					const raw = await fs.readFile(filePath, "utf8")
					await fs.unlink(filePath)
					const parsed = mapCommandSchema.safeParse(JSON.parse(raw))
					if (!parsed.success) {
						console.warn("[MapCommandWatcher] Rejected malformed command file:", file, parsed.error.message)
						continue
					}
					await this.applyCommand(parsed.data)
				} catch (err) {
					console.warn("[MapCommandWatcher] Failed command file:", file, err)
					try {
						await fs.unlink(filePath)
					} catch {
						/* ignore */
					}
				}
			}
		} catch {
			/* dir may not exist yet */
		} finally {
			this.processing = false
		}
	}

	private appendAgentCommandEvent(type: string, payload: Record<string, unknown> = {}): void {
		this.controller.mapSessionService.appendEvent({
			type,
			payloadJson: JSON.stringify(payload),
			timestampMs: Date.now(),
			source: "agent",
		})
	}

	private async applyCommand(cmd: MapCommandPayload): Promise<void> {
		switch (cmd.type) {
			case "set_roi": {
				if (cmd.roi?.geojson) {
					this.controller.mapSessionService.setActiveRoi(
						MapRoi.create({
							id: cmd.roi.id || "agent_roi",
							name: cmd.roi.name || "Agent ROI",
							source: cmd.roi.source || "agent",
							geojson: cmd.roi.geojson,
							areaHa: cmd.roi.area_ha ?? 0,
							workspacePath: cmd.roi.workspace_path || "",
						}),
						"agent",
					)
				}
				break
			}
			case "show_map": {
				if (cmd.open_map !== false) {
					try {
						const { VscodeMapPanelProvider } = await import("@/hosts/vscode/VscodeMapPanelProvider")
						await VscodeMapPanelProvider.createOrShow()
					} catch {
						const { sendMapButtonClickedEvent } = await import("@/core/controller/ui/subscribeToMapButtonClicked")
						await sendMapButtonClickedEvent()
					}
				}
				break
			}
			case "fit_extent":
				this.appendAgentCommandEvent("command.fit_extent")
				break
			case "fit_layer": {
				if (cmd.layer_id) {
					this.appendAgentCommandEvent("command.fit_layer", { layerId: cmd.layer_id })
				}
				break
			}
			case "update_layer": {
				if (!cmd.layer_id) {
					break
				}
				const patch: MapLayerPatch = {}
				if (cmd.style) {
					patch.style = cmd.style as MapLayerPatch["style"]
				}
				if (cmd.metadata) {
					patch.metadata = cmd.metadata
				}
				if (cmd.visible !== undefined) {
					patch.visible = cmd.visible
				}
				if (cmd.display_name) {
					patch.metadata = { ...(patch.metadata ?? {}), display_name: cmd.display_name }
					patch.name = cmd.display_name
				}
				if (cmd.clear_graduated) {
					patch.clear_graduated = true
				}
				const updated = this.controller.updateMapLayer(cmd.layer_id, patch)
				if (!updated) {
					console.warn("[MapCommandWatcher] update_layer: unknown layer", cmd.layer_id)
				}
				break
			}
			case "remove_layer": {
				if (cmd.layer_id) {
					this.controller.removeMapLayer(cmd.layer_id)
				}
				break
			}
			case "set_layer_visibility": {
				if (!cmd.layer_id || cmd.visible === undefined) {
					break
				}
				this.controller.updateMapLayer(cmd.layer_id, { visible: cmd.visible })
				const visibleIds = this.controller
					.getMapLayers()
					.filter((l) => l.visible !== false)
					.map((l) => l.id)
				this.controller.mapSessionService.setVisibleLayerIds(visibleIds)
				break
			}
			case "set_basemap": {
				if (cmd.basemap_id) {
					this.controller.mapSessionService.setBasemap(cmd.basemap_id, cmd.basemap_name)
				}
				break
			}
			default:
				console.warn("[MapCommandWatcher] Unknown command type:", cmd.type)
		}
	}
}
