// Browser automation has been removed. Stub for compilation compatibility.

// biome-ignore lint/suspicious/noExplicitAny: stub for removed feature
export async function handleBrowserTool(_config: any, _block: any): Promise<any> {
	throw new Error("Browser automation has been removed")
}

// Re-export as class for backward compatibility
// biome-ignore lint/complexity/noStaticOnlyClass: stub maintaining original export shape
export class BrowserToolHandler {
	// biome-ignore lint/suspicious/noExplicitAny: stub for removed feature
	static handle = handleBrowserTool
}
