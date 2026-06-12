import type { ClaimRecord, EvidenceSpanRecord, GetLedgerStateRequest, LedgerStateResponse } from "@shared/proto/cline/ledger"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import type { Controller } from ".."

const SESSIONS_DIR = path.join(os.homedir(), ".aihydro", "sessions")

/**
 * Load the claims for a session from ~/.aihydro/sessions/<id>.json.
 * If session_id is empty, reads the most recently modified session file.
 */
export async function getLedgerState(_controller: Controller, request: GetLedgerStateRequest): Promise<LedgerStateResponse> {
	try {
		let sessionId = request.sessionId?.trim() || ""
		let sessionPath: string

		if (sessionId) {
			sessionPath = path.join(SESSIONS_DIR, `${sessionId}.json`)
		} else {
			// Find most recently modified session file
			const entries = await fs.readdir(SESSIONS_DIR).catch(() => [] as string[])
			const jsonFiles = entries.filter((e) => e.endsWith(".json"))
			if (jsonFiles.length === 0) {
				return { sessionId: "", claims: [], updatedAtMs: 0 }
			}
			const withMtime = await Promise.all(
				jsonFiles.map(async (f) => {
					const stat = await fs.stat(path.join(SESSIONS_DIR, f)).catch(() => null)
					return { file: f, mtime: stat?.mtimeMs ?? 0 }
				}),
			)
			withMtime.sort((a, b) => b.mtime - a.mtime)
			const latest = withMtime[0].file
			sessionId = latest.replace(/\.json$/, "")
			sessionPath = path.join(SESSIONS_DIR, latest)
		}

		const raw = await fs.readFile(sessionPath, "utf8").catch(() => null)
		if (!raw) {
			return { sessionId, claims: [], updatedAtMs: 0 }
		}

		const session = JSON.parse(raw) as Record<string, unknown>
		const claimsRaw = (session.claims as Record<string, unknown> | undefined) ?? {}
		const stat = await fs.stat(sessionPath).catch(() => null)

		const claims: ClaimRecord[] = Object.entries(claimsRaw).map(([id, c]) => {
			const claim = c as Record<string, unknown>
			const spans = (claim.evidence_spans as unknown[] | undefined) ?? []
			const evidenceSpans: EvidenceSpanRecord[] = spans.map((s) => {
				const span = s as Record<string, unknown>
				return {
					sourceType: String(span.source_type ?? ""),
					sourceId: String(span.source_id ?? ""),
					metricRef: String(span.metric_ref ?? ""),
					description: String(span.description ?? ""),
				}
			})
			return {
				claimId: id,
				sessionId,
				statement: String(claim.claim ?? claim.statement ?? ""),
				status: String(claim.status ?? "proposed"),
				claimType: String(claim.claim_type ?? ""),
				confidence: String(claim.confidence ?? ""),
				createdAt: String(claim.created_at ?? ""),
				updatedAt: String(claim.updated_at ?? ""),
				evidenceSpans,
				limitations: ((claim.limitations as string[] | undefined) ?? []).map(String),
			}
		})

		return {
			sessionId,
			claims,
			updatedAtMs: stat?.mtimeMs ?? 0,
		}
	} catch (error) {
		console.error("[getLedgerState] Error:", error)
		return { sessionId: request.sessionId ?? "", claims: [], updatedAtMs: 0 }
	}
}
