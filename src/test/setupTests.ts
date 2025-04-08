import { vi } from "vitest"

// Mock VSCode API if needed for unit tests
vi.mock("vscode", () => {
	return {
		default: {
			window: {
				showInformationMessage: vi.fn(),
				createWebviewPanel: vi.fn(),
			},
			workspace: {
				getConfiguration: vi.fn(),
			},
			commands: {
				executeCommand: vi.fn(),
			},
			extensions: {
				getExtension: vi.fn(),
			},
			ViewColumn: {
				One: 1,
			},
		},
	}
})
