function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;")
}

export function formatToolCallXml(name: string, argumentJson: string): string {
	let parsedArgs: Record<string, unknown> | undefined
	if (argumentJson && argumentJson.trim().length > 0) {
		try {
			const maybeParsed = JSON.parse(argumentJson)
			if (maybeParsed && typeof maybeParsed === "object") {
				parsedArgs = maybeParsed as Record<string, unknown>
			}
		} catch (error) {
			console.error("Failed to parse function call arguments:", error)
		}
	}

	let xml = `<${name}>`
	if (parsedArgs) {
		for (const [key, rawValue] of Object.entries(parsedArgs)) {
			const stringValue =
				rawValue === null || rawValue === undefined
					? ""
					: typeof rawValue === "string"
						? rawValue
						: JSON.stringify(rawValue)
			xml += `<${key}>${escapeXml(stringValue)}</${key}>`
		}
	} else if (argumentJson && argumentJson.trim().length > 0) {
		xml += `<arguments>${escapeXml(argumentJson)}</arguments>`
	}
	xml += `</${name}>`
	return xml
}
