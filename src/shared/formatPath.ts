export function formatPath(path: string, os?: string, handleSpace: boolean = true): string {
	let formattedPath = path

	// Handle path prefix
	if (os === "win32") {
		formattedPath = formattedPath.startsWith("\\") ? formattedPath : `\\${formattedPath}`
	} else {
		formattedPath = formattedPath.startsWith("/") ? formattedPath : `/${formattedPath}`
	}

	// Handle space escaping
	if (handleSpace) {
		formattedPath = formattedPath.replaceAll(" ", os === "win32" ? "/ " : "\\ ")
	}

	return formattedPath
}
