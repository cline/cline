import { AiHydroEnv } from "@/config"

/**
 * Restricts which origins installModule/installCourse are allowed to fetch
 * from (audit finding E-2). Contributions to the Modules/Courses marketplace
 * go through a PR review against github.com/AI-Hydro/Modules and are served
 * from that repo's GitHub Pages deployment — there is no path today where a
 * legitimate `downloadUrl`/`manifestUrl` should point anywhere else. The
 * allowlist is derived from the *currently configured* base URLs (not a
 * hardcoded host) so `AI_HYDRO_MODULES_BASE_URL_LOCAL`-style dev overrides
 * keep working.
 *
 * This is not artifact signing or content-hash verification — the remote
 * `modules.json`/`courses.json` index doesn't carry an integrity hash today,
 * and adding one requires a coordinated change to the index-generating repo
 * this extension doesn't own (tracked in audits/STATUS.md E-2 as a followup).
 * A host allowlist is the containment we can ship unilaterally: it stops a
 * compromised or malicious index entry from pointing the extension at
 * attacker-controlled infrastructure, even without hash pinning.
 */
function trustedOrigins(): Set<string> {
	const cfg = AiHydroEnv.config()
	const origins = new Set<string>()
	for (const url of [cfg.modulesBaseUrl, cfg.researchGalleryBaseUrl, cfg.connectorsBaseUrl, cfg.skillsBaseUrl]) {
		try {
			origins.add(new URL(url).origin)
		} catch {
			// malformed config value — simply doesn't contribute an allowed origin
		}
	}
	return origins
}

export function assertTrustedMarketplaceUrl(url: string, context: string): void {
	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		throw new Error(`${context}: not a valid URL: ${url}`)
	}
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
		throw new Error(`${context}: unsupported protocol: ${parsed.protocol}`)
	}
	const allowed = trustedOrigins()
	if (!allowed.has(parsed.origin)) {
		throw new Error(`${context}: origin not in the marketplace allowlist: ${parsed.origin}`)
	}
}
