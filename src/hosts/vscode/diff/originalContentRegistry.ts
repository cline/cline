const diffOriginalContentRegistry = new Map<string, string>()
let nextDiffOriginalContentId = 0

export function registerDiffOriginalContent(content: string): string {
	const id = `diff-${Date.now()}-${nextDiffOriginalContentId++}`
	diffOriginalContentRegistry.set(id, content)
	return id
}

export function getRegisteredDiffOriginalContent(id: string): string {
	return diffOriginalContentRegistry.get(id) ?? ""
}

export function unregisterDiffOriginalContent(id: string | undefined): void {
	if (!id) {
		return
	}
	diffOriginalContentRegistry.delete(id)
}

export function getDiffOriginalContentIdFromUriPath(uriPath: string): string {
	return uriPath.replace(/^\/+/, "")
}
