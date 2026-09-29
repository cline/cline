import { createHash, randomUUID } from "node:crypto";
import {
	chmodSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { resolveClineDataDir } from "@cline/shared/storage";

export type CloudScope = {
	apiBaseUrl: string;
	accountId: string;
	organizationId?: string;
};
export function cloudScopeKey(scope: CloudScope): string {
	return createHash("sha256")
		.update(
			JSON.stringify([
				new URL(scope.apiBaseUrl).origin,
				scope.accountId,
				scope.organizationId ?? null,
			]),
		)
		.digest("hex");
}

function writePrivateJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	chmodSync(dirname(path), 0o700);
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, JSON.stringify(value), {
			mode: 0o600,
			flag: "wx",
		});
		renameSync(temporary, path);
	} finally {
		rmSync(temporary, { force: true });
	}
}

export type CreationIntent =
	| "start_pending"
	| "detached"
	| "cancel_requested"
	| "sent_confirmed"
	| "delivery_unknown"
	| "cleanup_unknown";
export type CloudCreationRecord = {
	version: 1;
	requestId: string;
	scope: CloudScope;
	createdAt: number;
	updatedAt: number;
	intent: CreationIntent;
	outerSessionId?: string;
	/** Consumed before the first send, or when attachment finds an existing task. */
	initialTaskPending?: boolean;
	prompt?: string;
	repoUrl: string;
	branch?: string;
	modelId: string;
	autoApproveTools: boolean;
};
export const CREATION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export class CloudCreationStore {
	constructor(
		private readonly root = join(
			resolveClineDataDir(),
			"cloud",
			"pending-creations",
		),
		private readonly now = Date.now,
	) {}
	private path(scope: CloudScope, requestId: string): string {
		if (!/^[a-zA-Z0-9_-]{1,100}$/.test(requestId))
			throw new Error("Invalid cloud creation request ID");
		return join(this.root, cloudScopeKey(scope), `${requestId}.json`);
	}
	save(record: CloudCreationRecord): void {
		// Explicit fields prevent credentials or unrelated local configuration being persisted.
		const {
			version,
			requestId,
			scope,
			createdAt,
			intent,
			outerSessionId,
			initialTaskPending,
			prompt,
			repoUrl,
			branch,
			modelId,
			autoApproveTools,
		} = record;
		writePrivateJson(this.path(scope, requestId), {
			version,
			requestId,
			scope: {
				apiBaseUrl: scope.apiBaseUrl,
				accountId: scope.accountId,
				organizationId: scope.organizationId,
			},
			createdAt,
			updatedAt: this.now(),
			intent,
			outerSessionId,
			initialTaskPending,
			prompt,
			repoUrl,
			branch,
			modelId,
			autoApproveTools,
		});
	}
	remove(record: CloudCreationRecord): void {
		rmSync(this.path(record.scope, record.requestId), { force: true });
	}
	list(scope: CloudScope): CloudCreationRecord[] {
		let names: string[];
		const directory = join(this.root, cloudScopeKey(scope));
		try {
			names = readdirSync(directory);
		} catch {
			return [];
		}
		return names.flatMap((name) => {
			if (!/^[a-zA-Z0-9_-]{1,100}\.json$/.test(name)) return [];
			try {
				const row = JSON.parse(
					readFileSync(join(directory, name), "utf8"),
				) as CloudCreationRecord;
				if (
					row.version !== 1 ||
					row.requestId !== name.slice(0, -5) ||
					cloudScopeKey(row.scope) !== cloudScopeKey(scope) ||
					typeof row.modelId !== "string" ||
					typeof row.repoUrl !== "string" ||
					typeof row.autoApproveTools !== "boolean" ||
					!Number.isFinite(row.createdAt) ||
					![
						"start_pending",
						"detached",
						"cancel_requested",
						"sent_confirmed",
						"delivery_unknown",
						"cleanup_unknown",
					].includes(row.intent)
				)
					return [];
				if (this.now() - row.createdAt > CREATION_RETENTION_MS) {
					this.remove(row);
					return [];
				}
				return [row];
			} catch {
				return [];
			}
		});
	}
}
