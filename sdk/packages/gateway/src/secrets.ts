/**
 * Owner-only secret files (Gateway RFC, Phase 3; ADR 0001).
 *
 * The Gateway owns credentials. Secrets are stored exclusively as
 * mode-0600 files in the Gateway's owner-only secrets directory
 * (`<dataDir>/secrets/<name>`, e.g. one file per LLM provider). They are
 * read by the Gateway process itself and injected in memory at the
 * engine boundary — never written into the database, the event log,
 * audit entries, projections, or logs, and never handed to clients or
 * workers.
 */

import {
	chmodSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import type { GatewayPaths } from "./paths";

export class SecretAccessError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SecretAccessError";
	}
}

export function writeSecretFile(
	paths: GatewayPaths,
	name: string,
	value: string,
): string {
	mkdirSync(paths.secretsDir, { recursive: true, mode: 0o700 });
	const file = paths.secretFile(name);
	writeFileSync(file, value, { mode: 0o600 });
	// `mode` only applies on creation; overwriting a pre-existing loose
	// file must tighten it too.
	chmodSync(file, 0o600);
	return file;
}

/**
 * Read a secret, refusing files that are readable by anyone but the
 * owner (a group/world-readable "secret" is treated as an error, not a
 * secret).
 */
export function readSecretFile(
	paths: GatewayPaths,
	name: string,
): string | undefined {
	const file = paths.secretFile(name);
	let stat: ReturnType<typeof statSync>;
	try {
		stat = statSync(file);
	} catch {
		return undefined;
	}
	if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
		throw new SecretAccessError(
			`Secret file ${file} is not owner-only (mode ${(stat.mode & 0o777).toString(8)}); refusing to read it`,
		);
	}
	return readFileSync(file, "utf8");
}
