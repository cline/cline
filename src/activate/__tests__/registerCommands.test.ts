// npx jest src/activate/__tests__/registerCommands.test.ts

import * as vscode from "vscode"
import { ClineProvider } from "../../core/webview/ClineProvider"

import { getVisibleProviderOrLog } from "../registerCommands"

jest.mock("execa", () => ({
	execa: jest.fn(),
}))

jest.mock("vscode", () => ({
	CodeActionKind: {
		QuickFix: { value: "quickfix" },
		RefactorRewrite: { value: "refactor.rewrite" },
	},
	window: {
		createTextEditorDecorationType: jest.fn().mockReturnValue({ dispose: jest.fn() }),
	},
}))

jest.mock("../../core/webview/ClineProvider")

describe("getVisibleProviderOrLog", () => {
	let mockOutputChannel: vscode.OutputChannel

	beforeEach(() => {
		mockOutputChannel = {
			appendLine: jest.fn(),
			append: jest.fn(),
			clear: jest.fn(),
			hide: jest.fn(),
			name: "mock",
			replace: jest.fn(),
			show: jest.fn(),
			dispose: jest.fn(),
		}
		jest.clearAllMocks()
	})

	it("returns the visible provider if found", () => {
		const mockProvider = {} as ClineProvider
		;(ClineProvider.getVisibleInstance as jest.Mock).mockReturnValue(mockProvider)

		const result = getVisibleProviderOrLog(mockOutputChannel)

		expect(result).toBe(mockProvider)
		expect(mockOutputChannel.appendLine).not.toHaveBeenCalled()
	})

	it("logs and returns undefined if no provider found", () => {
		;(ClineProvider.getVisibleInstance as jest.Mock).mockReturnValue(undefined)

		const result = getVisibleProviderOrLog(mockOutputChannel)

		expect(result).toBeUndefined()
		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith("Cannot find any visible Roo Code instances.")
	})
})
