/**
 * LedgerEventWatcher — polls ~/.aihydro/ledger_events/ for claim events
 * pushed by MCP tools (add_claim, update_claim_status).
 *
 * Mirrors MapCommandWatcher but emits ClaimUpdate events instead of
 * applying map layer mutations.
 */

import type { Controller } from "@core/controller"
import type { ClaimRecord, ClaimUpdate } from "@shared/proto/cline/ledger"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

const LEDGER_EVENTS_DIR = path.join(os.homedir(), ".aihydro", "ledger_events")
const POLL_INTERVAL_MS = 250

interface LedgerEventPayload {
	change_type: string
	session_id: string
	claim_id: string
	statement?: string
	status?: string
	claim_type?: string
	confidence?: string
	evidence_spans?: Array<{
		source_type?: string
		source_id?: string
		metric_ref?: string
		description?: string
	}>
	limitations?: string[]
	created_at?: string
}

export class LedgerEventWatcher {
	private intervalId: NodeJS.Timeout | null = null
	private processing = false

	constructor(private readonly controller: Controller) {}

	start(): void {
		if (this.intervalId) {
			return
		}
		void fs.mkdir(LEDGER_EVENTS_DIR, { recursive: true })
		this.intervalId = setInterval(() => void this.poll(), POLL_INTERVAL_MS)
		console.log("[LedgerEventWatcher] Started polling", LEDGER_EVENTS_DIR)
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
			const entries = await fs.readdir(LEDGER_EVENTS_DIR)
			const jsonFiles = entries.filter((e) => e.endsWith(".json")).sort()
			for (const file of jsonFiles) {
				const filePath = path.join(LEDGER_EVENTS_DIR, file)
				try {
					const raw = await fs.readFile(filePath, "utf8")
					await fs.unlink(filePath)
					const event = JSON.parse(raw) as LedgerEventPayload
					this.applyEvent(event)
				} catch (err) {
					console.warn("[LedgerEventWatcher] Failed event file:", file, err)
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

	private applyEvent(event: LedgerEventPayload): void {
		const claim: ClaimRecord = {
			claimId: event.claim_id,
			sessionId: event.session_id,
			statement: event.statement ?? "",
			status: event.status ?? "proposed",
			claimType: event.claim_type ?? "",
			confidence: event.confidence ?? "",
			createdAt: event.created_at ?? "",
			updatedAt: "",
			evidenceSpans: (event.evidence_spans ?? []).map((e) => ({
				sourceType: e.source_type ?? "",
				sourceId: e.source_id ?? "",
				metricRef: e.metric_ref ?? "",
				description: e.description ?? "",
			})),
			limitations: event.limitations ?? [],
		}

		const update: ClaimUpdate = {
			claim,
			changeType: event.change_type,
			timestampMs: Date.now(),
		}

		this.controller.notifyClaimUpdate(update)
	}
}
