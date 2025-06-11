const vscode = {
	env: {
		language: "en", // Default language for tests
		appName: "Visual Studio Code Test",
		appHost: "desktop",
		appRoot: "/test/path",
		machineId: "test-machine-id",
		sessionId: "test-session-id",
		shell: "/bin/zsh",
	},
	window: {
		showInformationMessage: jest.fn(),
		showErrorMessage: jest.fn(),
		createTextEditorDecorationType: jest.fn().mockReturnValue({
			dispose: jest.fn(),
		}),
		tabGroups: {
			onDidChangeTabs: jest.fn(() => {
				return {
					dispose: jest.fn(),
				}
			}),
			all: [],
		},
	},
	workspace: {
		onDidSaveTextDocument: jest.fn(),
		createFileSystemWatcher: jest.fn().mockReturnValue({
			onDidCreate: jest.fn().mockReturnValue({ dispose: jest.fn() }),
			onDidChange: jest.fn().mockReturnValue({ dispose: jest.fn() }),
			onDidDelete: jest.fn().mockReturnValue({ dispose: jest.fn() }),
			dispose: jest.fn(),
		}),
		fs: {
			stat: jest.fn(),
		},
	},
	Disposable: class {
		dispose() {}
	},
	Uri: {
		file: (path) => ({
			fsPath: path,
			scheme: "file",
			authority: "",
			path: path,
			query: "",
			fragment: "",
			with: jest.fn(),
			toJSON: jest.fn(),
		}),
	},
	EventEmitter: class {
		constructor() {
			this.event = jest.fn()
			this.fire = jest.fn()
		}
	},
	ConfigurationTarget: {
		Global: 1,
		Workspace: 2,
		WorkspaceFolder: 3,
	},
	Position: class {
		constructor(line, character) {
			this.line = line
			this.character = character
		}
	},
	Range: class {
		constructor(startLine, startCharacter, endLine, endCharacter) {
			this.start = new vscode.Position(startLine, startCharacter)
			this.end = new vscode.Position(endLine, endCharacter)
		}
	},
	ThemeColor: class {
		constructor(id) {
			this.id = id
		}
	},
	ExtensionMode: {
		Production: 1,
		Development: 2,
		Test: 3,
	},
	FileType: {
		Unknown: 0,
		File: 1,
		Directory: 2,
		SymbolicLink: 64,
	},
	TabInputText: class {
		constructor(uri) {
			this.uri = uri
		}
	},
	RelativePattern: class {
		constructor(base, pattern) {
			this.base = base
			this.pattern = pattern
		}
	},
}

module.exports = vscode
