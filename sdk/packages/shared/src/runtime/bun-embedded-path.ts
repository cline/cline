/**
 * Whether a module path points into a compiled Bun executable's embedded
 * virtual filesystem.
 *
 * Bun standalone binaries mount their bundled modules at `/$bunfs/root/...`
 * on POSIX but at the virtual drive `B:\~BUN\root\...` on Windows. Code that
 * only checked the POSIX prefix mis-detected Windows builds as running from
 * real source files — the hub daemon spawn then passed the unreadable
 * `B:\~BUN\root\entry.js` path as an argument instead of the
 * `--cline-hub-daemon` marker (observed verbatim in cline/cline#14292), so
 * Windows daemons were invisible to `cline doctor`'s marker-based process
 * scan and depended solely on the env sentinel to boot the right entrypoint.
 */
export function isBunEmbeddedModulePath(
	modulePath: string | undefined,
): boolean {
	const trimmed = modulePath?.trim();
	if (!trimmed) {
		return false;
	}
	if (trimmed.startsWith("/$bunfs/")) {
		return true;
	}
	const normalized = trimmed.replace(/\\/g, "/").toLowerCase();
	return normalized.startsWith("b:/~bun/");
}
