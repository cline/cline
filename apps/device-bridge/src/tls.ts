import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Self-signed certificate for the browser pet. Phones only expose the mic to
 * pages on a secure origin, so the web pet is served over HTTPS; the
 * certificate covers localhost plus the laptop's current LAN addresses and is
 * regenerated when those change. Requires `openssl` on PATH.
 */
export function ensureSelfSignedCert(
	dir: string,
	ips: string[],
): { cert: string; key: string; fresh: boolean } {
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const certPath = join(dir, "cert.pem");
	const keyPath = join(dir, "key.pem");
	const sansPath = join(dir, "sans.txt");
	const sans = [
		"DNS:localhost",
		"IP:127.0.0.1",
		...ips.map((ip) => `IP:${ip}`),
	].join(",");
	const current = existsSync(sansPath) ? readFileSync(sansPath, "utf8") : "";
	let fresh = false;
	if (!existsSync(certPath) || !existsSync(keyPath) || current !== sans) {
		const result = spawnSync(
			"openssl",
			[
				"req",
				"-x509",
				"-newkey",
				"rsa:2048",
				"-nodes",
				"-sha256",
				"-days",
				"825",
				"-subj",
				"/CN=Cline Pet Bridge",
				"-addext",
				`subjectAltName=${sans}`,
				"-keyout",
				keyPath,
				"-out",
				certPath,
			],
			{ stdio: "pipe" },
		);
		if (result.status !== 0) {
			throw new Error(
				`openssl failed to create the HTTPS certificate: ${result.stderr?.toString().trim() || result.error}`,
			);
		}
		writeFileSync(sansPath, sans, { mode: 0o600 });
		fresh = true;
	}
	return {
		cert: readFileSync(certPath, "utf8"),
		key: readFileSync(keyPath, "utf8"),
		fresh,
	};
}
