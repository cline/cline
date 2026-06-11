// Auto-discovery of OS trust anchors for the Cline CLI (CLINE-2353).
//
// The 3.x CLI ships as a Bun-compiled binary. Bun does not read the OS trust
// store unless NODE_USE_SYSTEM_CA is set, and even then its Windows enumeration
// covers only the `Root` store, not `CA`/Intermediate — so corporate MITM roots
// are not trusted out of the box and inference fails with "unable to get local
// issuer certificate". The pre-3.0 (Node) CLI did not have app-level CA handling
// either, so this restores zero-config trust the way JetBrains already does it:
// harvest the OS-trusted certificates and hand them to the child via
// NODE_EXTRA_CA_CERTS, which both Bun and Node honor reliably.
//
// This runs in the Node `bin/cline` wrapper (not Bun), so tls.getCACertificates
// can read the full OS store — including Windows `Root` AND `CA` — without any
// flag, before the Bun child's TLS context initializes.
//
// Kept as dependency-free CommonJS with injectable modules so the logic is unit
// testable and ships verbatim in the published wrapper package.

const PEM_MARKER = "-----BEGIN CERTIFICATE-----";

/**
 * Returns OS-trusted certificates as PEM strings, or [] when unavailable.
 * tls.getCACertificates("system") requires Node >= 22 and reads the OS store
 * directly (no --use-system-ca flag needed).
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

/** Returns the file's PEM text, or null when missing, unreadable, or not PEM. */
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
		const text = fs.readFileSync(userPath, "utf8");
		// Binary DER would not have loaded in the runtime either; require PEM.
		return text.includes(PEM_MARKER) ? text : null;
	} catch {
		return null;
	}
}

/**
 * Concatenates the user's PEM (if any) and the system certificates into one
 * bundle. A separating newline is inserted between parts so adjacent END/BEGIN
 * markers cannot fuse into one invalid line.
 */
function buildBundle({ systemCerts, userPem }) {
	const parts = [];
	if (userPem) {
		parts.push(userPem);
	}
	for (const cert of systemCerts) {
		parts.push(cert);
	}
	return parts
		.map((part) => (part.endsWith("\n") ? part : `${part}\n`))
		.join("");
}

/**
 * Harvests OS trust anchors, merges them with any user NODE_EXTRA_CA_CERTS, and
 * points env.NODE_EXTRA_CA_CERTS at a single managed PEM bundle. Mutates `env`
 * in place and returns the managed path, or null when nothing was changed (no
 * system certs available — the user's existing setting is left untouched).
 */
function configureNodeExtraCaCerts(env, deps = {}) {
	const fs = deps.fs || require("node:fs");
	const os = deps.os || require("node:os");
	const path = deps.path || require("node:path");

	const systemCerts = harvestSystemCerts(deps.tls);
	if (systemCerts.length === 0) {
		// Nothing to add: do not clobber a user-provided NODE_EXTRA_CA_CERTS,
		// and let the runtime fall back to its bundled CAs otherwise.
		return null;
	}

	const userPath = (env.NODE_EXTRA_CA_CERTS || "").trim() || null;
	const managedDir = env.CLINE_DIR?.trim() || path.join(os.homedir(), ".cline");
	const managedPath = path.join(managedDir, "cli-node-extra-ca-certs.pem");

	// Guard against the user pointing NODE_EXTRA_CA_CERTS at our own managed
	// file, which would otherwise re-append the system certs every launch.
	const userIsManaged =
		userPath && path.resolve(userPath) === path.resolve(managedPath);
	const userPem = userIsManaged ? null : readUserBundle(fs, userPath);

	const bundle = buildBundle({ systemCerts, userPem });
	try {
		fs.mkdirSync(managedDir, { recursive: true });
		const tmp = `${managedPath}.${process.pid}.tmp`;
		// Owner read/write: the bundle holds public CA material, not secrets,
		// but there is no reason to make it world-writable.
		fs.writeFileSync(tmp, bundle, { mode: 0o600 });
		fs.renameSync(tmp, managedPath);
		env.NODE_EXTRA_CA_CERTS = managedPath;
		return managedPath;
	} catch {
		return null;
	}
}

module.exports = {
	harvestSystemCerts,
	readUserBundle,
	buildBundle,
	configureNodeExtraCaCerts,
};
