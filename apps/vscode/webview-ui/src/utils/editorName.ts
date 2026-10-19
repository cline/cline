/**
 * The editor's name as users say it, for copy like "after you close PyCharm".
 * Hosts report full product names: VS Code's app name ("Visual Studio Code - Insiders")
 * and JetBrains products with their edition ("PyCharm Professional"). Forks like Cursor
 * report their own name. Falls back to "your IDE" when the host is unknown.
 */
export function editorName(hostName: string | undefined): string {
	const name = hostName?.trim()
	if (!name) {
		return "your IDE"
	}
	return name
		.replace(/^Visual Studio Code(?: - )?/, "VS Code ")
		.replace(/ (?:Ultimate|Community|Professional|Educational)(?: Edition)?$/, "")
		.trim()
}
