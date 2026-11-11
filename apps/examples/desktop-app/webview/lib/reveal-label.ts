/** What each desktop calls showing a file in its file manager. */
export function revealActionLabel(
	userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
): string {
	if (/mac/i.test(userAgent)) return "Reveal in Finder";
	if (/windows|win32|win64/i.test(userAgent)) return "Show in File Explorer";
	// Linux file managers share no way to select a file, so its folder opens.
	return "Open containing folder";
}
