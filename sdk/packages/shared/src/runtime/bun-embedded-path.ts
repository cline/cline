/**
 * Whether a module path points into a compiled Bun executable's embedded
 * virtual filesystem: `/$bunfs/root/...` on POSIX, `B:\~BUN\root\...` on
 * Windows.
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
