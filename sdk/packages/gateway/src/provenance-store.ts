/**
 * Run provenance store (Gateway RFC, Phase 6).
 *
 * Every run records how it entered the system — interactive, connector,
 * or automation — in the same transaction as its admission. Automations
 * are ordinary runs with `mode: "automation"` provenance, never a
 * parallel execution path.
 */

import type { RunId, RunProvenance } from "@cline/shared/gateway";
import { RunProvenanceSchema } from "@cline/shared/gateway";
import type { GatewayDatabase } from "./db";

export class RunProvenanceStore {
	private readonly database: GatewayDatabase;

	constructor(database: GatewayDatabase) {
		this.database = database;
	}

	record(runId: RunId, provenance: RunProvenance, now: number): void {
		this.database.db
			.prepare(
				`INSERT INTO run_provenance (run_id, mode, provenance_json, created_at)
				VALUES (?, ?, ?, ?)
				ON CONFLICT(run_id) DO NOTHING;`,
			)
			.run(runId, provenance.mode, JSON.stringify(provenance), now);
	}

	get(runId: RunId): RunProvenance | undefined {
		const row = this.database.db
			.prepare("SELECT provenance_json FROM run_provenance WHERE run_id = ?;")
			.get(runId);
		if (!row) {
			return undefined;
		}
		return RunProvenanceSchema.parse(JSON.parse(String(row.provenance_json)));
	}

	countByMode(mode: RunProvenance["mode"]): number {
		const row = this.database.db
			.prepare("SELECT COUNT(*) AS n FROM run_provenance WHERE mode = ?;")
			.get(mode);
		return Number(row?.n ?? 0);
	}
}
