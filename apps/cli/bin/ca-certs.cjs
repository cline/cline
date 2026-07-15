// Auto-discovery of OS trust anchors for the Cline CLI.
//
// Bun does not read the OS trust store, so the 3.x CLI cannot see corporate
// MITM / self-signed CAs out of the box. This runs in the Node `bin/cline`
// wrapper (not Bun), reads the full OS store via tls.getCACertificates("system")
// (Node >= 22, no --use-system-ca flag), and hands the certs to the Bun child
// via NODE_EXTRA_CA_CERTS, which both runtimes honor. Mirrors the JetBrains
// plugin's configureCertificates(), sourcing from the OS instead of the IDE.
//
// Dependency-free CommonJS with injectable modules so it is unit-testable and
// ships verbatim in the published wrapper package.

const PEM_MARKER = "-----BEGIN CERTIFICATE-----";
const CERT_BLOCK =
	/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;

/**
 * Returns only the complete certificate blocks from PEM text, or null when
 * there are none. User files may also hold private keys (combined cert+key
 * PEMs) or other sections, which must never be copied into the managed
 * bundle. Files that contain nothing but certificates pass through verbatim
 * so unchanged bundles keep hash-skipping the rewrite.
 */
function sanitizePem(text) {
	const blocks = text.match(CERT_BLOCK) ?? [];
	if (blocks.length === 0) {
		return null;
	}
	const rest = text.replace(CERT_BLOCK, "");
	if (/^\s*$/.test(rest)) {
		return text;
	}
	return `${blocks.join("\n")}\n`;
}

/**
 * Returns OS-trusted certificates as PEM strings, or [] when unavailable.
 * tls.getCACertificates("system") requires Node >= 22.
 */
function harvestSystemCerts(tlsModule) {
	try {
		const tls = tlsModule || require("node:tls");
		if (typeof tls.getCACertificates !== "function") {
			return [];
		}
		const certs = tls.getCACertificates("system");
		if (!Array.isArray(certs)) {
			return [];
		}
		return certs.filter(
			(cert) => typeof cert === "string" && cert.includes(PEM_MARKER),
		);
	} catch {
		return [];
	}
}

/**
 * Returns the file's certificate blocks as PEM text, or null when missing,
 * unreadable, or holding no complete certificate block.
 */
function readUserBundle(fsModule, userPath) {
	if (!userPath) {
		return null;
	}
	try {
		const fs = fsModule || require("node:fs");
		const stat = fs.statSync(userPath, { throwIfNoEntry: false });
		if (!stat || !stat.isFile()) {
			return null;
		}
		// Binary DER would not have loaded in the runtime either; require PEM.
		return sanitizePem(fs.readFileSync(userPath, "utf8"));
	} catch {
		return null;
	}
}

/**
 * Reads the user's NODE_EXTRA_CA_CERTS value into PEM strings. Node treats the
 * value as a single file, but some users set an OS-path-delimited list; the
 * whole value is tried as one file first, then split.
 * The managed bundle is excluded so reading it back never re-appends its certs.
 */
function readUserCerts(fsModule, pathModule, value, managedPath) {
	if (!value) {
		return [];
	}
	const fs = fsModule || require("node:fs");
	const path = pathModule || require("node:path");
	const candidates = [];
	const whole = readUserBundle(fs, value);
	if (whole) {
		candidates.push({ filePath: value, pem: whole });
	} else if (value.includes(path.delimiter)) {
		for (const segment of value.split(path.delimiter)) {
			const trimmed = segment.trim();
			if (!trimmed) {
				continue;
			}
			const pem = readUserBundle(fs, trimmed);
			if (pem) {
				candidates.push({ filePath: trimmed, pem });
			}
		}
	}
	const pems = [];
	for (const candidate of candidates) {
		const isManaged =
			managedPath &&
			path.resolve(candidate.filePath) === path.resolve(managedPath);
		if (!isManaged) {
			pems.push(candidate.pem);
		}
	}
	return pems;
}

/**
 * Concatenates the user PEMs (if any) and the system certificates into one
 * bundle. A separating newline is inserted between parts so adjacent END/BEGIN
 * markers cannot fuse into one invalid line.
 */
function buildBundle({ systemCerts, userPems }) {
	const parts = [...(userPems ?? []), ...systemCerts];
	return parts
		.map((part) => (part.endsWith("\n") ? part : `${part}\n`))
		.join("");
}

/** Counts individual PEM certificates across the given bundle strings. */
function countCerts(pems) {
	let count = 0;
	for (const pem of pems) {
		count += pem.split(PEM_MARKER).length - 1;
	}
	return count;
}

function readFileIfExists(fs, filePath) {
	try {
		return fs.readFileSync(filePath, "utf8");
	} catch {
		return null;
	}
}

function resolveClineDir(env, os, path) {
	return env.CLINE_DIR?.trim() || path.join(os.homedir(), ".cline");
}

/**
 * True when the api-unavailable warning should print. Stamped per Node version
 * in the cline dir so the nudge shows once rather than on every command; a
 * version change (upgrade that still falls short, or downgrade) re-arms it.
 * When the stamp cannot be read or written, warn — bookkeeping failures must
 * never suppress a real diagnostic.
 */
function shouldWarnApiUnavailable(env, deps = {}) {
	const fs = deps.fs || require("node:fs");
	const os = deps.os || require("node:os");
	const path = deps.path || require("node:path");
	const version = deps.nodeVersion || process.versions.node;
	const dir = resolveClineDir(env, os, path);
	const stamp = path.join(dir, `.ca-api-warned-${version}`);
	try {
		if (fs.existsSync(stamp)) {
			return false;
		}
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(stamp, "", { mode: 0o600 });
		return true;
	} catch {
		return true;
	}
}

/** Atomically writes [content] to [target]; returns true on success. */
function writeBundle(fs, dir, target, content) {
	const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
	try {
		fs.mkdirSync(dir, { recursive: true });
		// Owner read/write: the bundle holds public CA material, not secrets,
		// but there is no reason to make it world-writable.
		fs.writeFileSync(tmp, content, { mode: 0o600 });
		try {
			fs.renameSync(tmp, target);
		} catch {
			// Windows can reject rename over a file a concurrent child holds open.
			fs.rmSync(target, { force: true });
			fs.renameSync(tmp, target);
		}
		return true;
	} catch {
		// Never leave a partial temp file behind (e.g. ENOSPC mid-write).
		try {
			fs.rmSync(tmp, { force: true });
		} catch {
			// Ignore: best-effort cleanup.
		}
		return false;
	}
}

/**
 * Harvests OS trust anchors, merges them with any user NODE_EXTRA_CA_CERTS, and
 * points env.NODE_EXTRA_CA_CERTS at a single managed PEM bundle. Mutates `env`
 * in place. Returns an outcome the caller can log; `action` is one of
 * "unchanged" | "written" | "write-failed-reused" | "write-failed" |
 * "no-system-certs" | "api-unavailable".
 */
function configureNodeExtraCaCerts(env, deps = {}) {
	const fs = deps.fs || require("node:fs");
	const os = deps.os || require("node:os");
	const path = deps.path || require("node:path");
	const tls = deps.tls || require("node:tls");

	// tls.getCACertificates("system") needs Node >= 22.15; on older Nodes the
	// harvest cannot run at all, which the caller should surface to the user.
	if (typeof tls.getCACertificates !== "function") {
		return {
			action: "api-unavailable",
			path: null,
			systemCertCount: 0,
			userCertCount: 0,
		};
	}

	const systemCerts = harvestSystemCerts(tls);
	if (systemCerts.length === 0) {
		// Nothing to add: leave any user-provided NODE_EXTRA_CA_CERTS untouched
		// and let the runtime fall back to its bundled CAs.
		return {
			action: "no-system-certs",
			path: null,
			systemCertCount: 0,
			userCertCount: 0,
		};
	}

	const managedDir = resolveClineDir(env, os, path);
	const managedPath = path.join(managedDir, "cli-node-extra-ca-certs.pem");
	const userValue = (env.NODE_EXTRA_CA_CERTS || "").trim() || null;
	const userPems = readUserCerts(fs, path, userValue, managedPath);
	const bundle = buildBundle({ systemCerts, userPems });
	const base = {
		path: managedPath,
		systemCertCount: systemCerts.length,
		userCertCount: countCerts(userPems),
	};

	// Skip the rewrite when the bundle is already current. Avoids per-launch I/O
	// and the concurrent-rename race in the steady state.
	if (readFileIfExists(fs, managedPath) === bundle) {
		env.NODE_EXTRA_CA_CERTS = managedPath;
		return { ...base, action: "unchanged" };
	}

	if (writeBundle(fs, managedDir, managedPath, bundle)) {
		env.NODE_EXTRA_CA_CERTS = managedPath;
		return { ...base, action: "written" };
	}

	// Write failed: fall back to a previously-written bundle if one exists.
	if (readFileIfExists(fs, managedPath)) {
		env.NODE_EXTRA_CA_CERTS = managedPath;
		return { ...base, action: "write-failed-reused" };
	}
	return { ...base, path: null, action: "write-failed" };
}

module.exports = {
	harvestSystemCerts,
	sanitizePem,
	readUserBundle,
	readUserCerts,
	buildBundle,
	countCerts,
	configureNodeExtraCaCerts,
	shouldWarnApiUnavailable,
};
