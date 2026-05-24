/**
 * PreviewCommandWatcher — polls ~/.aihydro/preview_commands/ for commands
 * from Python MCP tools (preview_focus_cell, preview_revise_section, etc.).
 *
 * Mirrors src/core/map/MapCommandWatcher.ts. Each command is a JSON file
 * dropped by the MCP server; we read it, dispatch it, then delete it.
 *
 * Commands are translated into PreviewEvent records so the iframe (which
 * subscribes via window.message listeners) can react — e.g. scrolling to a
 * cell, highlighting it, or applying a revised HTML section.
 */

import type { Controller } from "@core/controller"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

const PREVIEW_COMMANDS_DIR = path.join(os.homedir(), ".aihydro", "preview_commands")
const POLL_INTERVAL_MS = 250

interface PreviewCommandPayload {
	type: string
	module_id?: string
	cell_id?: string
	section_id?: string
	new_html?: string
	comment_id?: string
	new_text?: string
	[key: string]: unknown
}

export class PreviewCommandWatcher {
	private intervalId: NodeJS.Timeout | null = null
	private processing = false

	constructor(private readonly controller: Controller) {}

	start(): void {
		if (this.intervalId) {
			return
		}
		void fs.mkdir(PREVIEW_COMMANDS_DIR, { recursive: true })
		this.intervalId = setInterval(() => void this.poll(), POLL_INTERVAL_MS)
		console.log("[PreviewCommandWatcher] Started polling", PREVIEW_COMMANDS_DIR)
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
			const entries = await fs.readdir(PREVIEW_COMMANDS_DIR)
			const jsonFiles = entries.filter((e) => e.endsWith(".json")).sort()
			for (const file of jsonFiles) {
				const filePath = path.join(PREVIEW_COMMANDS_DIR, file)
				try {
					const raw = await fs.readFile(filePath, "utf8")
					await fs.unlink(filePath)
					const cmd = JSON.parse(raw) as PreviewCommandPayload
					await this.applyCommand(cmd)
				} catch (err) {
					console.warn("[PreviewCommandWatcher] Failed command file:", file, err)
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

	private appendAgentEvent(kind: string, moduleId: string, payload: Record<string, unknown> = {}): void {
		this.controller.previewSessionService.appendEvent({
			moduleId,
			cellId: typeof payload.cellId === "string" ? payload.cellId : undefined,
			kind,
			payloadJson: JSON.stringify(payload),
			timestampMs: Date.now(),
			source: "agent",
		})
	}

	private async applyCommand(cmd: PreviewCommandPayload): Promise<void> {
		const moduleId = cmd.module_id ?? "unknown"
		switch (cmd.type) {
			case "focus_cell": {
				if (!cmd.cell_id) {
					break
				}
				// The agent wants the iframe to scroll + highlight a cell. We
				// emit a command event; HtmlPreviewView (Phase 1+) subscribes
				// and forwards into the iframe via postMessage("artifact/command").
				this.appendAgentEvent("command.focus_cell", moduleId, {
					cellId: cmd.cell_id,
					moduleId,
				})
				break
			}
			case "revise_section": {
				if (!cmd.section_id || typeof cmd.new_html !== "string") {
					break
				}
				// Phase 4: this command propagates to the iframe which swaps the
				// section HTML in-place. For now we just record the intent so the
				// MCP tool round-trips cleanly.
				this.appendAgentEvent("command.revise_section", moduleId, {
					sectionId: cmd.section_id,
					newHtml: cmd.new_html,
					moduleId,
				})
				break
			}
			case "address_comment": {
				if (!cmd.comment_id) {
					break
				}
				this.appendAgentEvent("command.address_comment", moduleId, {
					commentId: cmd.comment_id,
					newText: cmd.new_text,
					moduleId,
				})
				break
			}
			case "show_preview": {
				// Convenience: agent asks the panel to come to the front. Maps
				// to the existing `show_html_preview` MCP tool path; ignore here.
				break
			}
			default:
				console.warn("[PreviewCommandWatcher] Unknown command type:", cmd.type)
		}
	}
}
