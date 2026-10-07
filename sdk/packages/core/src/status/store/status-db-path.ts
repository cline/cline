import { join } from "node:path";
import { resolveDbDataDir } from "@cline/shared/storage";

/**
 * Status Hub storage is its own SQLite file: it has its own
 * retention, and it should not contend on session storage.
 */
export function resolveStatusDbPath(): string {
	const explicitPath = process.env.CLINE_STATUS_DB_PATH?.trim();
	if (explicitPath) {
		return explicitPath;
	}
	return join(resolveDbDataDir(), "status.db");
}
