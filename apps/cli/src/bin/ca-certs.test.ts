import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// The helper ships as CommonJS in the published wrapper package, so it is
// loaded via require rather than an ESM import.
const caCerts = require("../../bin/ca-certs.cjs") as {
	harvestSystemCerts: (tls?: unknown) => string[];
	readUserBundle: (fs: unknown, p: string | null) => string | null;
	readUserCerts: (
		fs: unknown,
		path: unknown,
		value: string | null,
		managedPath: string | null,
	) => string[];
	buildBundle: (input: {
		systemCerts: string[];
		userPems?: string[];
	}) => string;
	countCerts: (pems: string[]) => number;
	configureNodeExtraCaCerts: (
		env: Record<string, string>,
		deps?: { tls?: unknown; fs?: unknown },
	) => {
		action: string;
		path: string | null;
		systemCertCount: number;
		userCertCount: number;
	};
};

const fs = require("node:fs");
const path = require("node:path");

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
			expect(
				caCerts.harvestSystemCerts(fakeTls([certSystem, "not-a-cert", 42])),
			).toEqual([certSystem]);
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

		it("strips non-certificate sections such as private keys", () => {
			// Combined cert+key files (nginx/haproxy style) are common; the key
			// must never reach the managed bundle.
			const p = join(dir, "combined.pem");
			writeFileSync(
				p,
				`${certUser}\n-----BEGIN PRIVATE KEY-----\nSECRET\n-----END PRIVATE KEY-----\n`,
			);
			const out = caCerts.readUserBundle(fs, p);
			expect(out).toContain("USER");
			expect(out).not.toContain("PRIVATE KEY");
			expect(out).not.toContain("SECRET");
		});

		it("keeps certificates-only files verbatim", () => {
			// Byte-identical passthrough keeps the unchanged-skip hash stable.
			const p = join(dir, "clean.pem");
			writeFileSync(p, `${certUser}\n${certSystem}`);
			expect(caCerts.readUserBundle(fs, p)).toBe(`${certUser}\n${certSystem}`);
		});

		it("returns null for a BEGIN marker without a complete block", () => {
			const p = join(dir, "truncated.pem");
			writeFileSync(p, "-----BEGIN CERTIFICATE-----\ntruncated");
			expect(caCerts.readUserBundle(fs, p)).toBeNull();
		});
	});

	describe("readUserCerts", () => {
		it("reads a single PEM file path", () => {
			const p = join(dir, "corp.pem");
			writeFileSync(p, certUser);
			expect(caCerts.readUserCerts(fs, path, p, null)).toEqual([certUser]);
		});

		it("splits a legacy OS-path-delimited value and reads each PEM", () => {
			// Legacy footgun: NODE_EXTRA_CA_CERTS="a.pem;b.pem".
			const a = join(dir, "a.pem");
			const b = join(dir, "b.pem");
			writeFileSync(a, certUser);
			writeFileSync(b, certSystem);
			expect(
				caCerts.readUserCerts(fs, path, [a, b].join(delimiter), null),
			).toEqual([certUser, certSystem]);
		});

		it("skips missing segments in a delimited value", () => {
			const a = join(dir, "a.pem");
			writeFileSync(a, certUser);
			const value = [a, join(dir, "missing.pem")].join(delimiter);
			expect(caCerts.readUserCerts(fs, path, value, null)).toEqual([certUser]);
		});

		it("excludes the managed bundle from user certs", () => {
			const managed = join(dir, "cli-node-extra-ca-certs.pem");
			writeFileSync(managed, certUser);
			expect(caCerts.readUserCerts(fs, path, managed, managed)).toEqual([]);
		});

		it("returns [] for empty value", () => {
			expect(caCerts.readUserCerts(fs, path, null, null)).toEqual([]);
		});
	});

	describe("buildBundle", () => {
		it("merges user PEMs before system certs", () => {
			expect(
				caCerts.buildBundle({
					systemCerts: [certSystem],
					userPems: [certUser],
				}),
			).toBe(`${certUser}\n${certSystem}`);
		});

		it("inserts a separating newline so END/BEGIN markers do not fuse", () => {
			// certUser has no trailing newline, so this proves the boundary fix.
			const merged = caCerts.buildBundle({
				systemCerts: [certSystem],
				userPems: [certUser],
			});
			expect(merged).not.toContain(
				"-----END CERTIFICATE----------BEGIN CERTIFICATE-----",
			);
		});

		it("handles no user PEMs", () => {
			expect(caCerts.buildBundle({ systemCerts: [certSystem] })).toBe(
				certSystem,
			);
		});
	});

	describe("configureNodeExtraCaCerts", () => {
		it("writes a managed bundle and points the env var at it", () => {
			const env: Record<string, string> = { CLINE_DIR: dir };
			const out = caCerts.configureNodeExtraCaCerts(env, {
				tls: fakeTls([certSystem]),
			});
			expect(out.action).toBe("written");
			expect(out.path).toBe(join(dir, "cli-node-extra-ca-certs.pem"));
			expect(env.NODE_EXTRA_CA_CERTS).toBe(out.path);
			expect(readFileSync(out.path as string, "utf8")).toContain("SYSTEM");
		});

		it("merges a user-supplied NODE_EXTRA_CA_CERTS with system certs", () => {
			const userPath = join(dir, "corp.pem");
			writeFileSync(userPath, certUser);
			const env: Record<string, string> = {
				CLINE_DIR: dir,
				NODE_EXTRA_CA_CERTS: userPath,
			};
			const out = caCerts.configureNodeExtraCaCerts(env, {
				tls: fakeTls([certSystem]),
			});
			expect(out.userCertCount).toBe(1);
			const written = readFileSync(env.NODE_EXTRA_CA_CERTS, "utf8");
			expect(written).toContain("USER");
			expect(written).toContain("SYSTEM");
		});

		it("reports unchanged and skips rewrite on the second run", () => {
			const env: Record<string, string> = { CLINE_DIR: dir };
			expect(
				caCerts.configureNodeExtraCaCerts(env, { tls: fakeTls([certSystem]) })
					.action,
			).toBe("written");
			expect(
				caCerts.configureNodeExtraCaCerts(env, { tls: fakeTls([certSystem]) })
					.action,
			).toBe("unchanged");
		});

		it("does not re-append when the user already points at the managed bundle", () => {
			const env: Record<string, string> = { CLINE_DIR: dir };
			const first = caCerts.configureNodeExtraCaCerts(env, {
				tls: fakeTls([certSystem]),
			}).path as string;
			const env2: Record<string, string> = {
				CLINE_DIR: dir,
				NODE_EXTRA_CA_CERTS: first,
			};
			caCerts.configureNodeExtraCaCerts(env2, { tls: fakeTls([certSystem]) });
			const written = readFileSync(env2.NODE_EXTRA_CA_CERTS, "utf8");
			expect(written.match(/SYSTEM/g)?.length).toBe(1);
		});

		it("no-ops when no system certs are available", () => {
			const env: Record<string, string> = {
				CLINE_DIR: dir,
				NODE_EXTRA_CA_CERTS: "/user/corp.pem",
			};
			const out = caCerts.configureNodeExtraCaCerts(env, { tls: fakeTls([]) });
			expect(out.action).toBe("no-system-certs");
			expect(out.path).toBeNull();
			expect(env.NODE_EXTRA_CA_CERTS).toBe("/user/corp.pem");
		});

		it("reports api-unavailable on Nodes without getCACertificates", () => {
			const env: Record<string, string> = {
				CLINE_DIR: dir,
				NODE_EXTRA_CA_CERTS: "/user/corp.pem",
			};
			const out = caCerts.configureNodeExtraCaCerts(env, { tls: {} });
			expect(out.action).toBe("api-unavailable");
			expect(out.path).toBeNull();
			expect(env.NODE_EXTRA_CA_CERTS).toBe("/user/corp.pem");
		});

		it("reports write-failed when the bundle cannot be written", () => {
			const realFs = require("node:fs");
			const failingFs = {
				...realFs,
				mkdirSync: () => {
					throw new Error("EACCES");
				},
				writeFileSync: () => {
					throw new Error("EACCES");
				},
			};
			const env: Record<string, string> = { CLINE_DIR: dir };
			const out = caCerts.configureNodeExtraCaCerts(env, {
				tls: fakeTls([certSystem]),
				fs: failingFs,
			});
			expect(out.action).toBe("write-failed");
			expect(out.path).toBeNull();
			expect(env.NODE_EXTRA_CA_CERTS).toBeUndefined();
		});

		it("reuses a stale bundle when the rewrite fails", () => {
			// First run writes the bundle normally.
			const env: Record<string, string> = { CLINE_DIR: dir };
			const managedPath = caCerts.configureNodeExtraCaCerts(env, {
				tls: fakeTls([certSystem]),
			}).path as string;

			// Second run: writes fail, but the stale bundle is still readable.
			const realFs = require("node:fs");
			const failingFs = {
				...realFs,
				mkdirSync: () => {
					throw new Error("EACCES");
				},
				writeFileSync: () => {
					throw new Error("EACCES");
				},
			};
			const env2: Record<string, string> = { CLINE_DIR: dir };
			const out = caCerts.configureNodeExtraCaCerts(env2, {
				// A different system cert forces a rewrite attempt (not "unchanged").
				tls: fakeTls([certUser]),
				fs: failingFs,
			});

			expect(out.action).toBe("write-failed-reused");
			expect(env2.NODE_EXTRA_CA_CERTS).toBe(managedPath);
		});
	});

	describe("countCerts", () => {
		it("counts individual certificates, not files", () => {
			// One file holding two certs must report 2, not 1.
			const twoInOne = `${certUser}\n${certSystem}`;
			expect(caCerts.countCerts([twoInOne])).toBe(2);
			expect(caCerts.countCerts([certUser, certSystem])).toBe(2);
			expect(caCerts.countCerts([])).toBe(0);
		});
	});
});
