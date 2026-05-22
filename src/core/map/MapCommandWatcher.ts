/**
 * MapCommandWatcher — polls ~/.aihydro/map_commands/ for commands from Python MCP tools.
 *
 * Commands: set_roi, fit_extent, show_map
 */

import type { Controller } from "@core/controller"
import { MapRoi } from "@shared/proto/cline/map"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

const MAP_COMMANDS_DIR = path.join(os.homedir(), ".aihydro", "map_commands")
const POLL_INTERVAL_MS = 250

interface MapCommandPayload {
	type: string
	roi?: {
		id?: string
		name?: string
		source?: string
		geojson?: string
		area_ha?: number
		workspace_path?: string
	}
	open_map?: boolean
}

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
					const cmd = JSON.parse(raw) as MapCommandPayload
					await this.applyCommand(cmd)
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
				// Webview handles fit via session; emit event for UI
				this.controller.mapSessionService.appendEvent({
					type: "command.fit_extent",
					payloadJson: "{}",
					timestampMs: Date.now(),
					source: "agent",
				})
				break
			default:
				console.warn("[MapCommandWatcher] Unknown command type:", cmd.type)
		}
	}
}
