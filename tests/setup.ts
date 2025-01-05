import { vi } from "vitest"
import * as vscode from "vscode"

vi.mock("vscode", async (importOriginal) => {
	const actualVscode = await importOriginal<typeof import("vscode")>()

	// Mock EventEmitter
	const createMockEventEmitter = () => {
		const listeners: Array<(e: any) => any> = []
		return {
			event: (listener: (e: any) => any) => {
				listeners.push(listener)
				return vi.fn()
			},
			fire: (e: any) => {
				listeners.forEach((listener) => listener(e))
			},
			dispose: vi.fn(),
		}
	}

	// Mock Uri
	const mockUri = {
		scheme: "file",
		authority: "",
		path: "/mock/path",
		query: "",
		fragment: "",
		fsPath: "/mock/path",
		with: vi.fn().mockReturnThis(),
		toString: vi.fn().mockReturnValue("/mock/path"),
	}

	return {
		...actualVscode,
		Uri: {
			...actualVscode.Uri,
			file: vi.fn().mockReturnValue(mockUri),
			joinPath: vi.fn().mockImplementation((base, ...pathSegments) => ({
				fsPath: `${base.fsPath}/${pathSegments.join("/")}`,
				scheme: base.scheme,
				authority: base.authority,
				path: `${base.path}/${pathSegments.join("/")}`,
			})),
		},
		ThemeIcon: vi.fn().mockImplementation((iconName: string) => ({
			id: iconName,
		})),
		ViewColumn: {
			...actualVscode.ViewColumn,
			Two: 2,
		},
		commands: {
			registerCommand: vi.fn().mockImplementation((command, callback, thisArg) => ({
				dispose: vi.fn(),
			})),
			registerTextEditorCommand: vi.fn().mockImplementation((command, callback) => ({
				dispose: vi.fn(),
			})),
			executeCommand: vi
				.fn()
				.mockImplementation(async <T>(command: string, ...rest: any[]): Promise<T | undefined> => undefined),
			getCommands: vi.fn().mockResolvedValue([]),
		},
		EventEmitter: vi.fn().mockImplementation(() => ({
			event: vi.fn(),
			fire: vi.fn(),
			dispose: vi.fn(),
		})),
		window: {
			...actualVscode.window,
			activeTextEditor: undefined,
			visibleTextEditors: [],
			terminals: [] as vscode.Terminal[],
			createOutputChannel: vi.fn().mockImplementation(
				(name: string, languageId?: string): vscode.OutputChannel => ({
					name,
					languageId: languageId ?? "Log",
					append: vi.fn(),
					appendLine: vi.fn(),
					clear: vi.fn(),
					show: vi.fn(),
					hide: vi.fn(),
					dispose: vi.fn(),
				}),
			),
			registerWebviewViewProvider: vi
				.fn()
				.mockImplementation(
					(viewId: string, provider: vscode.WebviewViewProvider, options?: vscode.WebviewViewOptions) => ({
						dispose: vi.fn(),
					}),
				),
			registerUriHandler: vi.fn().mockImplementation((handler: vscode.UriHandler) => ({
				dispose: vi.fn(),
			})),
			createWebviewPanel: vi
				.fn()
				.mockImplementation(
					(
						viewType: string,
						title: string,
						showOptions: vscode.ViewColumn | { viewColumn: vscode.ViewColumn; preserveFocus?: boolean },
						options?: vscode.WebviewPanelOptions,
					) => ({
						webview: {
							html: "",
							onDidReceiveMessage: vi.fn(),
							postMessage: vi.fn(),
							asWebviewUri: vi.fn(),
						},
						reveal: vi.fn(),
						dispose: vi.fn(),
					}),
				),
			showInformationMessage: vi.fn().mockResolvedValue(undefined),
			createTextEditorDecorationType: vi.fn().mockImplementation(() => ({
				dispose: vi.fn(),
				key: "mock-decoration-type",
			})),
			onDidStartTerminalShellExecution: createMockEventEmitter(),
			onDidCloseTerminal: createMockEventEmitter(),
			onDidChangeTerminalShellIntegration: createMockEventEmitter(),
			terminals: {
				get: vi.fn().mockReturnValue([]),
				length: 0,
			},
			activeTerminal: null as vscode.Terminal | null,
			createTerminal: vi.fn().mockImplementation((options?: vscode.TerminalOptions) => {
				const terminal: vscode.Terminal = {
					name: options?.name || "Mock Terminal",
					processId: Promise.resolve(Math.floor(Math.random() * 10000)),
					state: {
						isInteractedWith: false,
					},
					shellIntegration: {
						cwd: vi.fn().mockReturnValue(mockUri),
						read: vi.fn(),
						onDidChangeShellType: vi.fn(),
						onDidChangeShellPid: vi.fn(),
					},
					sendText: vi.fn(),
					show: vi.fn(),
					hide: vi.fn(),
					dispose: vi.fn(),
					creationOptions: options || {},
					exitStatus: undefined,
				}
				this.terminals.push(terminal)
				return terminal
			}),
		},
		workspace: {
			...actualVscode.workspace,
			workspaceFolders: [
				{
					uri: mockUri,
					name: "MockWorkspace",
					index: 0,
				},
			],
			registerTextDocumentContentProvider: vi
				.fn()
				.mockImplementation((scheme: string, provider: vscode.TextDocumentContentProvider) => ({
					dispose: vi.fn(),
				})),
			onDidOpenTextDocument: vi.fn().mockImplementation(() => createMockEventEmitter().event),
			onDidCloseTextDocument: vi.fn().mockImplementation(() => createMockEventEmitter().event),
			onDidChangeTextDocument: vi.fn().mockImplementation(() => createMockEventEmitter().event),
			onWillSaveTextDocument: vi.fn().mockImplementation(() => createMockEventEmitter().event),
			onDidSaveTextDocument: vi.fn().mockImplementation(() => createMockEventEmitter().event),
			onDidCreateFiles: vi.fn().mockImplementation(() => createMockEventEmitter().event),
			onDidRenameFiles: vi.fn().mockImplementation(() => createMockEventEmitter().event),
			onDidDeleteFiles: vi.fn().mockImplementation(() => createMockEventEmitter().event),
			onDidChangeWorkspaceFolders: vi.fn().mockImplementation(() => createMockEventEmitter().event),
		},
	}
})

// Mock `p-wait-for` using vitest
vi.mock("p-wait-for", () => {
	return {
		default: vi.fn(
			(conditionFn: () => boolean | Promise<boolean>, options?: { timeout?: number; interval?: number }) => {
				const { timeout = 4000, interval = 100 } = options || {}
				let elapsed = 0

				return new Promise((resolve, reject) => {
					const intervalId = setInterval(async () => {
						elapsed += interval

						if (await conditionFn()) {
							clearInterval(intervalId)
							resolve(true)
						} else if (elapsed >= timeout) {
							clearInterval(intervalId)
							reject(new Error("Timeout exceeded"))
						}
					}, interval)
				})
			},
		),
	}
})
