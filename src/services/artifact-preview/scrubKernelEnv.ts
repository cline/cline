/**
 * Strip secret-shaped variables from the artifact kernel's child-process
 * environment. Mirrors `aihydro-tools/ai_hydro/mcp/tools_execution.py::_scrub_env`
 * (Wave 0 item 0.1) — same blocklist, same rationale, applied here because the
 * kernel spawn previously passed `process.env` through unfiltered (audit
 * finding E-4).
 *
 * Blocklist (not allowlist): preserves PATH/HOME/PYTHONPATH/CONDA_PREFIX/etc
 * so legitimate artifact code (including GEE/HF workflows that need auth
 * files under $HOME) keeps working, while dropping anything that looks like
 * an API key, token, or credential. This is a scrub, not a security boundary
 * — a cell can still read credential *files* under $HOME (e.g. GEE's
 * ~/.config/earthengine/credentials); see ArtifactKernelService's docstring.
 */
const SECRET_ENV_PATTERN =
	/(_KEY$|_TOKEN$|_SECRET$|CREDENTIAL|_PASSWORD$|^AWS_|^HF_|^HUGGING_FACE|^EARTHENGINE|^GOOGLE_APPLICATION|^GEE_|^ANTHROPIC_|^OPENAI_)/i

export function scrubKernelEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const scrubbed: NodeJS.ProcessEnv = {}
	for (const [key, value] of Object.entries(env)) {
		if (!SECRET_ENV_PATTERN.test(key)) {
			scrubbed[key] = value
		}
	}
	return scrubbed
}
