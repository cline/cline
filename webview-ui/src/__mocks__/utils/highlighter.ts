export type ExtendedLanguage = string

export const highlighter = {
	codeToHtml: jest.fn((code: string) => `<pre><code>${code}</code></pre>`),
	getLoadedThemes: jest.fn(() => []),
	loadTheme: jest.fn(),
}

export const getHighlighter = jest.fn(() => Promise.resolve(highlighter))

export const isLanguageLoaded = jest.fn(() => true)

export const normalizeLanguage = jest.fn((lang: string): ExtendedLanguage => lang)

// Mock bundledLanguages
export const bundledLanguages = {
	javascript: jest.fn(),
	typescript: jest.fn(),
	python: jest.fn(),
	html: jest.fn(),
	css: jest.fn(),
	json: jest.fn(),
	// Add more as needed
}
