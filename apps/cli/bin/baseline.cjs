"use strict";

// Baseline (non-AVX2) binary selection for the Cline CLI.
//
// Bun's default x64 builds require AVX2 and crash with an illegal
// instruction (SIGILL) on older CPUs and on VMs whose hypervisor does not
// expose AVX2. Bun also ships "baseline" compile targets that run on those
// systems, so we publish a `-baseline` variant of every x64 platform
// package and pick the right one at install/run time.
//
// This module must stay plain CommonJS with Node-only APIs: it is required
// by both the `bin/cline` resolver and `postinstall.mjs`, which run under
// whatever Node.js npm used.

const childProcess = require("child_process");
const fs = require("fs");

// `platform` uses package-name convention ("windows", not "win32").
function supportsAvx2(platform, arch) {
	if (arch !== "x64") {
		return false;
	}

	if (platform === "linux") {
		try {
			return /(^|\s)avx2(\s|$)/i.test(fs.readFileSync("/proc/cpuinfo", "utf8"));
		} catch {
			return false;
		}
	}

	if (platform === "darwin") {
		try {
			const result = childProcess.spawnSync(
				"sysctl",
				["-n", "hw.optional.avx2_0"],
				{
					encoding: "utf8",
					timeout: 1500,
				},
			);
			if (result.status !== 0) {
				return false;
			}
			return (result.stdout || "").trim() === "1";
		} catch {
			return false;
		}
	}

	if (platform === "windows") {
		// PF_AVX2_INSTRUCTIONS_AVAILABLE = 40
		const command =
			'(Add-Type -MemberDefinition "[DllImport(""kernel32.dll"")] public static extern bool IsProcessorFeaturePresent(int ProcessorFeature);" -Name Kernel32 -Namespace Win32 -PassThru)::IsProcessorFeaturePresent(40)';

		for (const executable of [
			"powershell.exe",
			"pwsh.exe",
			"pwsh",
			"powershell",
		]) {
			try {
				const result = childProcess.spawnSync(
					executable,
					["-NoProfile", "-NonInteractive", "-Command", command],
					{
						encoding: "utf8",
						timeout: 3000,
						windowsHide: true,
					},
				);
				if (result.status !== 0) {
					continue;
				}
				const output = (result.stdout || "").trim().toLowerCase();
				if (output === "true" || output === "1") {
					return true;
				}
				if (output === "false" || output === "0") {
					return false;
				}
			} catch {
				// Try the next PowerShell executable.
			}
		}
		return false;
	}

	return false;
}

// Ordered list of platform package names to try. When AVX2 is missing the
// baseline package comes first; the non-baseline package stays in the list
// as a last resort so a missing baseline package still resolves to
// something rather than nothing.
function platformPackageNames(platform, arch, avx2) {
	const base = "@cline/cli-" + platform + "-" + arch;
	if (arch !== "x64") {
		return [base];
	}
	if (avx2) {
		return [base, base + "-baseline"];
	}
	return [base + "-baseline", base];
}

function resolvePlatformPackageNames(platform, arch) {
	return platformPackageNames(platform, arch, supportsAvx2(platform, arch));
}

module.exports = {
	supportsAvx2,
	platformPackageNames,
	resolvePlatformPackageNames,
};
