/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from "vitest"

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

export interface ExtensionContext {
	secrets: {
		get: (key: string) => Promise<string | undefined>
		store: (key: string, value: string) => Promise<void>
		delete: (key: string) => Promise<void>
	}
	globalState: {
		get: <T>(key: string) => T | undefined
		update: (key: string, value: any) => Promise<void>
	}
	extension?: {
		packageJSON?: {
			version?: string
		}
	}
}

// Mock implementation for tests
export const mockExtensionContext: ExtensionContext = {
	secrets: {
		get: vi.fn().mockResolvedValue(undefined),
		store: vi.fn().mockResolvedValue(undefined),
		delete: vi.fn().mockResolvedValue(undefined),
	},
	globalState: {
		get: vi.fn().mockReturnValue(undefined),
		update: vi.fn().mockResolvedValue(undefined),
	},
	extension: {
		packageJSON: {
			version: "1.0.0",
		},
	},
}
