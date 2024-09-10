const hljsToTextMate: Record<string, string[]> = {
	".hljs-comment": ["comment"],
	".hljs-tag": ["tag"],
	".hljs-doctag": ["keyword"],
	".hljs-keyword": ["keyword"],
	".hljs-meta .hljs-keyword": ["keyword"],
	".hljs-template-tag": ["keyword"],
	".hljs-template-variable": ["keyword"],
	".hljs-type": ["keyword"],
	".hljs-variable.language_": ["keyword"],
	".hljs-title": ["title", "function", "class"],
	".hljs-title.class_": ["title", "function", "class", "variable"],
	".hljs-title.class_.inherited__": ["title", "function", "class", "variable"],
	".hljs-title.function_": ["support.function", "entity.name.function", "title", "function", "class"],
	".hljs-built_in": ["support.function", "entity.name.function", "title", "function", "class"],
	".hljs-name": ["constant"],
	".hljs-attr": ["variable", "operator", "number"],
	".hljs-attribute": ["attribute", "variable", "operator", "number"],
	".hljs-literal": ["variable", "operator", "number"],
	".hljs-meta": ["variable", "operator", "number"],
	".hljs-number": ["constant.numeric", "number", "variable", "operator"],
	".hljs-operator": ["variable", "operator", "number"],
	".hljs-variable": ["variable", "operator", "number"],
	".hljs-selector-attr": ["variable", "operator", "number"],
	".hljs-selector-class": ["variable", "operator", "number"],
	".hljs-selector-id": ["variable", "operator", "number"],
	".hljs-regexp": ["string"],
	".hljs-string": ["string"],
	".hljs-meta .hljs-string": ["string"],
	".hljs-params": ["variable", "operator", "number"],
}

type FullColorTheme = {
	rules?: {
		token?: string
		foreground?: string
	}[]
}

function constructTheme(tmTheme: FullColorTheme): Record<string, string> {
	const rules = tmTheme["rules"] || []

	const tokenToForeground: Record<string, string> = {}
	rules.forEach(({ token, foreground }) => {
		if (!foreground || !token) {
			return
		}
		tokenToForeground[token] = foreground
	})

	const theme: Record<string, string> = {}
	Object.keys(hljsToTextMate).forEach((className) => {
		const tokens = hljsToTextMate[className]
		for (const scope of tokens) {
			if (tokenToForeground[scope]) {
				theme[className] = tokenToForeground[scope]
				break
			}
		}
	})

	if (Object.keys(theme).length === 0) {
		return fallbackTheme()
	}

	return theme
}

function fallbackTheme() {
	const styles = getComputedStyle(document.body)
	const backgroundColor = styles.getPropertyValue("--vscode-editor-background")
	const { r, g, b } = parseHexColor(backgroundColor)
	const avg = (r + g + b) / 3

	return avg >= 128
		? {
				".hljs-comment": "#008000",
				".hljs-doctag": "#0000ff",
				".hljs-keyword": "#0000ff",
				".hljs-meta .hljs-keyword": "#0000ff",
				".hljs-template-tag": "#0000ff",
				".hljs-template-variable": "#0000ff",
				".hljs-type": "#0000ff",
				".hljs-variable.language_": "#0000ff",
				".hljs-title.class_": "#001080",
				".hljs-title.class_.inherited__": "#001080",
				".hljs-title.function_": "#795E26",
				".hljs-built_in": "#795E26",
				".hljs-attr": "#001080",
				".hljs-attribute": "#001080",
				".hljs-literal": "#001080",
				".hljs-meta": "#001080",
				".hljs-number": "#098658",
				".hljs-operator": "#001080",
				".hljs-variable": "#001080",
				".hljs-selector-attr": "#001080",
				".hljs-selector-class": "#001080",
				".hljs-selector-id": "#001080",
				".hljs-regexp": "#a31515",
				".hljs-string": "#a31515",
				".hljs-meta .hljs-string": "#a31515",
				".hljs-params": "#001080",
		  }
		: {
				".hljs-comment": "#6A9955",
				".hljs-doctag": "#569cd6",
				".hljs-keyword": "#569cd6",
				".hljs-meta .hljs-keyword": "#569cd6",
				".hljs-template-tag": "#569cd6",
				".hljs-template-variable": "#569cd6",
				".hljs-type": "#569cd6",
				".hljs-variable.language_": "#569cd6",
				".hljs-title.class_": "#9CDCFE",
				".hljs-title.class_.inherited__": "#9CDCFE",
				".hljs-title.function_": "#DCDCAA",
				".hljs-built_in": "#DCDCAA",
				".hljs-attr": "#9CDCFE",
				".hljs-attribute": "#9CDCFE",
				".hljs-literal": "#9CDCFE",
				".hljs-meta": "#9CDCFE",
				".hljs-number": "#b5cea8",
				".hljs-operator": "#9CDCFE",
				".hljs-variable": "#9CDCFE",
				".hljs-selector-attr": "#9CDCFE",
				".hljs-selector-class": "#9CDCFE",
				".hljs-selector-id": "#9CDCFE",
				".hljs-regexp": "#ce9178",
				".hljs-string": "#ce9178",
				".hljs-meta .hljs-string": "#ce9178",
				".hljs-params": "#9CDCFE",
		  }
}

export function convertTextMateToHljs(fullColorTheme: any) {
	return constructTheme(fullColorTheme || {})
}

function parseHexColor(hexColor: string): {
	r: number
	g: number
	b: number
} {
	if (hexColor.startsWith("#")) {
		hexColor = hexColor.slice(1)
	}

	if (hexColor.length > 6) {
		hexColor = hexColor.slice(0, 6)
	}

	const r = parseInt(hexColor.substring(0, 2), 16)
	const g = parseInt(hexColor.substring(2, 4), 16)
	const b = parseInt(hexColor.substring(4, 6), 16)

	return { r, g, b }
}
