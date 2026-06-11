import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// The helper ships as CommonJS in the published wrapper package, so it is
// loaded via require rather than an ESM import.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const caCerts = require("../../bin/ca-certs.cjs") as {
	harvestSystemCerts: (tls?: unknown) => string[];
	readUserBundle: (fs: unknown, p: string | null) => string | null;
	buildBundle: (input: {
		systemCerts: string[];
		userPem: string | null;
	}) => string;
	configureNodeExtraCaCerts: (
		env: Record<string, string>,
		deps?: { tls?: unknown },
	) => string | null;
};

const certSystem =
	"-----BEGIN CERTIFICATE-----\nSYSTEM\n-----END CERTIFICATE-----\n";
const certUser = "-----BEGIN CERTIFICATE-----\nUSER\n-----END CERTIFICATE-----";

function fakeTls(certs: unknown) {
	return { getCACertificates: () => certs };
}

describe("ca-certs", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "cline-ca-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	describe("harvestSystemCerts", () => {
		it("returns only PEM strings from the system store", () => {
			const result = caCerts.harvestSystemCerts(
				fakeTls([certSystem, "not-a-cert", 42]),
			);
			expect(result).toEqual([certSystem]);
		});

		it("returns [] when getCACertificates is unavailable", () => {
			expect(caCerts.harvestSystemCerts({})).toEqual([]);
		});

		it("returns [] when getCACertificates throws", () => {
			expect(
				caCerts.harvestSystemCerts({
					getCACertificates: () => {
						throw new Error("nope");
					},
				}),
			).toEqual([]);
		});
	});

	describe("readUserBundle", () => {
		const fs = require("node:fs");

		it("returns PEM contents for a PEM file", () => {
			const p = join(dir, "user.pem");
			writeFileSync(p, certUser);
			expect(caCerts.readUserBundle(fs, p)).toBe(certUser);
		});

		it("returns null for a non-PEM (DER) file", () => {
			const p = join(dir, "user.der");
			writeFileSync(p, Buffer.from([0x30, 0x82, 0x01, 0x02]));
			expect(caCerts.readUserBundle(fs, p)).toBeNull();
		});

		it("returns null for a missing file and for null path", () => {
			expect(caCerts.readUserBundle(fs, join(dir, "nope.pem"))).toBeNull();
			expect(caCerts.readUserBundle(fs, null)).toBeNull();
		});
	});

	describe("buildBundle", () => {
		it("merges user PEM before system certs", () => {
			const merged = caCerts.buildBundle({
				systemCerts: [certSystem],
				userPem: certUser,
			});
			expect(merged).toBe(`${certUser}\n${certSystem}`);
		});

		it("inserts a separating newline so END/BEGIN markers do not fuse", () => {
			const merged = caCerts.buildBundle({
				systemCerts: [certSystem],
				userPem: certUser,
			});
			expect(merged).not.toContain(
				"-----END CERTIFICATE----------BEGIN CERTIFICATE-----",
			);
		});

		it("handles no user PEM", () => {
			expect(
				caCerts.buildBundle({ systemCerts: [certSystem], userPem: null }),
			).toBe(certSystem);
		});
	});

	describe("configureNodeExtraCaCerts", () => {
		it("writes a managed bundle and points the env var at it", () => {
			const env: Record<string, string> = { CLINE_DIR: dir };
			const out = caCerts.configureNodeExtraCaCerts(env, {
				tls: fakeTls([certSystem]),
			});
			expect(out).toBe(join(dir, "cli-node-extra-ca-certs.pem"));
			expect(env.NODE_EXTRA_CA_CERTS).toBe(out);
			expect(readFileSync(out as string, "utf8")).toContain("SYSTEM");
		});

		it("merges a user-supplied NODE_EXTRA_CA_CERTS with system certs", () => {
			const userPath = join(dir, "corp.pem");
			writeFileSync(userPath, certUser);
			const env: Record<string, string> = {
				CLINE_DIR: dir,
				NODE_EXTRA_CA_CERTS: userPath,
			};
			caCerts.configureNodeExtraCaCerts(env, { tls: fakeTls([certSystem]) });
			const written = readFileSync(env.NODE_EXTRA_CA_CERTS, "utf8");
			expect(written).toContain("USER");
			expect(written).toContain("SYSTEM");
		});

		it("does not re-append when the user already points at the managed bundle", () => {
			const env: Record<string, string> = { CLINE_DIR: dir };
			const first = caCerts.configureNodeExtraCaCerts(env, {
				tls: fakeTls([certSystem]),
			}) as string;
			// Second launch with NODE_EXTRA_CA_CERTS set to our own managed file.
			const env2: Record<string, string> = {
				CLINE_DIR: dir,
				NODE_EXTRA_CA_CERTS: first,
			};
			caCerts.configureNodeExtraCaCerts(env2, { tls: fakeTls([certSystem]) });
			const written = readFileSync(env2.NODE_EXTRA_CA_CERTS, "utf8");
			// Exactly one SYSTEM block, not duplicated.
			expect(written.match(/SYSTEM/g)?.length).toBe(1);
		});

		it("leaves the env untouched when no system certs are available", () => {
			const env: Record<string, string> = {
				CLINE_DIR: dir,
				NODE_EXTRA_CA_CERTS: "/user/corp.pem",
			};
			const out = caCerts.configureNodeExtraCaCerts(env, {
				tls: fakeTls([]),
			});
			expect(out).toBeNull();
			expect(env.NODE_EXTRA_CA_CERTS).toBe("/user/corp.pem");
		});
	});
});
