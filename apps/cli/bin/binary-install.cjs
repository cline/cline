// Shared helper for locating and repairing the platform-specific Cline CLI
// binary. Used by the postinstall script and the bin/cline resolver.
//
// npm treats optionalDependencies as best-effort: if downloading or
// extracting a platform package fails (registry mirror that has not synced
// the package yet, `--no-optional` / `omit=optional` config, antivirus
// interference on Windows, transient network errors), the install still
// succeeds and the user only finds out when `cline` cannot locate its
// binary. As a fallback, this module downloads the platform package tarball
// directly from the npm registry and extracts the compiled binary.
//
// Must run on plain Node.js (no Bun APIs, no dependencies) because it ships
// inside the published npm wrapper package.

"use strict";

const fs = require("fs");
const https = require("https");
const http = require("http");
const path = require("path");
const zlib = require("zlib");

const DEFAULT_REGISTRY = "https://registry.npmjs.org";

// Maps Node's os.platform()/os.arch() to the platform package name and the
// binary filename inside it. Returns undefined for unsupported platforms.
function getPlatformTarget(platform, arch) {
	const platformMap = { darwin: "darwin", linux: "linux", win32: "windows" };
	const archMap = { x64: "x64", arm64: "arm64" };
	const mappedPlatform = platformMap[platform];
	const mappedArch = archMap[arch];
	if (!mappedPlatform || !mappedArch) {
		return undefined;
	}
	return {
		packageName: "@cline/cli-" + mappedPlatform + "-" + mappedArch,
		binaryName: platform === "win32" ? "cline.exe" : "cline",
		// The runtime cache created next to the resolver script.
		cacheName: platform === "win32" ? ".cline.exe" : ".cline",
	};
}

// npm exposes the effective registry to lifecycle scripts via
// npm_config_registry. Outside of npm scripts, fall back to the default.
function resolveRegistryBase(env) {
	const raw = env?.npm_config_registry;
	const registry =
		typeof raw === "string" && /^https?:\/\//.test(raw)
			? raw
			: DEFAULT_REGISTRY;
	return registry.replace(/\/+$/, "");
}

function buildTarballUrl(registryBase, packageName, version) {
	// Tarball URLs use the unscoped name in the filename segment:
	// https://registry.npmjs.org/@cline/cli-windows-x64/-/cli-windows-x64-3.0.49.tgz
	const unscoped = packageName.startsWith("@")
		? packageName.split("/")[1]
		: packageName;
	return (
		registryBase + "/" + packageName + "/-/" + unscoped + "-" + version + ".tgz"
	);
}

function fetchUrl(url, redirectsLeft) {
	return new Promise((resolve, reject) => {
		const client = url.startsWith("http:") ? http : https;
		const request = client.get(url, (response) => {
			const status = response.statusCode || 0;
			if (status >= 300 && status < 400 && response.headers.location) {
				response.resume();
				if (redirectsLeft <= 0) {
					reject(new Error("Too many redirects fetching " + url));
					return;
				}
				resolve(
					fetchUrl(
						new URL(response.headers.location, url).toString(),
						redirectsLeft - 1,
					),
				);
				return;
			}
			if (status !== 200) {
				response.resume();
				reject(new Error("Download failed with HTTP " + status + ": " + url));
				return;
			}
			const chunks = [];
			response.on("data", (chunk) => {
				chunks.push(chunk);
			});
			response.on("end", () => {
				resolve(Buffer.concat(chunks));
			});
			response.on("error", reject);
		});
		request.on("error", reject);
	});
}

function downloadFile(url) {
	return fetchUrl(url, 5);
}

// Minimal ustar reader: finds one entry by path in a gzipped tarball.
// Handles the ustar prefix field; npm tarballs always prefix entries with
// "package/". Returns the entry contents or undefined if not found.
function extractEntryFromTarGz(tgzBuffer, entryPath) {
	const tar = zlib.gunzipSync(tgzBuffer);
	let offset = 0;
	while (offset + 512 <= tar.length) {
		const header = tar.subarray(offset, offset + 512);
		const name = readTarString(header, 0, 100);
		if (name.length === 0) {
			break; // end-of-archive marker
		}
		const size = parseInt(readTarString(header, 124, 12), 8) || 0;
		const typeflag = header[156];
		const prefix = readTarString(header, 345, 155);
		const fullName = prefix ? prefix + "/" + name : name;
		const dataStart = offset + 512;
		// typeflag "0" or NUL means a regular file
		if ((typeflag === 48 || typeflag === 0) && fullName === entryPath) {
			return tar.subarray(dataStart, dataStart + size);
		}
		offset = dataStart + Math.ceil(size / 512) * 512;
	}
	return undefined;
}

function readTarString(buffer, start, length) {
	let end = start;
	const max = start + length;
	while (end < max && buffer[end] !== 0) {
		end++;
	}
	return buffer.subarray(start, end).toString("utf8");
}

// Downloads the platform package from the npm registry and writes the
// compiled binary to destPath. Returns the destination path.
async function installBinaryFromRegistry(options) {
	const registryBase = resolveRegistryBase(options.env || process.env);
	const url = buildTarballUrl(
		registryBase,
		options.packageName,
		options.version,
	);
	const download = options.downloadImpl || downloadFile;
	const tgz = await download(url);
	const entryPath = "package/bin/" + options.binaryName;
	const binary = extractEntryFromTarGz(tgz, entryPath);
	if (!binary || binary.length === 0) {
		throw new Error("Could not find " + entryPath + " in " + url);
	}
	fs.mkdirSync(path.dirname(options.destPath), { recursive: true });
	// Write to a temp file first so a concurrent `cline` invocation never
	// sees a partially written binary, then rename into place.
	const tempPath = options.destPath + ".download-" + process.pid;
	fs.writeFileSync(tempPath, binary, { mode: 0o755 });
	try {
		fs.renameSync(tempPath, options.destPath);
	} catch (error) {
		fs.rmSync(tempPath, { force: true });
		throw error;
	}
	try {
		fs.chmodSync(options.destPath, 0o755);
	} catch {
		// Windows has no chmod semantics; the file is executable as written.
	}
	return options.destPath;
}

// Explains the likely causes when the platform package is missing after a
// successful `npm install`. Shared by the resolver and postinstall output.
function missingBinaryHelp(packageName) {
	return (
		"The platform package " +
		packageName +
		" is missing from node_modules.\n" +
		"npm installs it as an optional dependency, and silently skips it when:\n" +
		"  - npm was run with --no-optional / --omit=optional\n" +
		"  - the download failed (offline, proxy, or a registry mirror that\n" +
		"    has not synced " +
		packageName +
		" yet)\n" +
		"  - antivirus software blocked or quarantined the binary (common on Windows)\n\n" +
		"Try reinstalling with:  npm install -g cline --force\n" +
		"If you use a registry mirror, install straight from npm:\n" +
		"  npm install -g cline --registry=https://registry.npmjs.org"
	);
}

module.exports = {
	DEFAULT_REGISTRY,
	getPlatformTarget,
	resolveRegistryBase,
	buildTarballUrl,
	downloadFile,
	extractEntryFromTarGz,
	installBinaryFromRegistry,
	missingBinaryHelp,
};
