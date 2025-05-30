export const bundledLanguages = {
	javascript: jest.fn(),
	typescript: jest.fn(),
	python: jest.fn(),
	html: jest.fn(),
	css: jest.fn(),
	json: jest.fn(),
	// Add more as needed
}

export const bundledThemes = {}

export type BundledTheme = string
export type BundledLanguage = string
export type Highlighter = any
export type ShikiTransformer = any

export const createHighlighter = jest.fn(() =>
	Promise.resolve({
		codeToHtml: jest.fn((code: string) => `<pre><code>${code}</code></pre>`),
		getLoadedThemes: jest.fn(() => []),
		loadTheme: jest.fn(),
	}),
)

export const codeToHast = jest.fn()
export const codeToHtml = jest.fn((code: string) => `<pre><code>${code}</code></pre>`)
export const codeToTokens = jest.fn()
export const codeToTokensBase = jest.fn()
export const codeToTokensWithThemes = jest.fn()
export const getLastGrammarState = jest.fn()
export const getSingletonHighlighter = jest.fn()
