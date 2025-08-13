/**
 * Minimal mock for the vscode module.
 * Used in tests to prevent module resolution errors.
 * The actual vscode API is only available in VS Code extension contexts.
 */

export const window = {
	showInformationMessage: vi.fn(),
	showErrorMessage: vi.fn(),
}

export const env = {
	openExternal: vi.fn(),
}

export const Uri = {
	parse: vi.fn((uri: string) => ({ toString: () => uri })),
}
