// Mock VSCode API for Vitest tests
const mockEventEmitter = () => ({
	event: () => () => {},
	fire: () => {},
	dispose: () => {},
})

const mockDisposable = {
	dispose: () => {},
}

const mockUri = {
	file: (path) => ({ fsPath: path, path, scheme: "file" }),
	parse: (path) => ({ fsPath: path, path, scheme: "file" }),
}

const mockRange = class {
	constructor(start, end) {
		this.start = start
		this.end = end
	}
}

const mockPosition = class {
	constructor(line, character) {
		this.line = line
		this.character = character
	}
}

const mockSelection = class extends mockRange {
	constructor(start, end) {
		super(start, end)
		this.anchor = start
		this.active = end
	}
}

export const workspace = {
	workspaceFolders: [],
	getWorkspaceFolder: () => null,
	onDidChangeWorkspaceFolders: () => mockDisposable,
	createFileSystemWatcher: () => ({
		onDidCreate: () => mockDisposable,
		onDidChange: () => mockDisposable,
		onDidDelete: () => mockDisposable,
		dispose: () => {},
	}),
	fs: {
		readFile: () => Promise.resolve(new Uint8Array()),
		writeFile: () => Promise.resolve(),
		stat: () => Promise.resolve({ type: 1, ctime: 0, mtime: 0, size: 0 }),
	},
}

export const window = {
	activeTextEditor: null,
	onDidChangeActiveTextEditor: () => mockDisposable,
	showErrorMessage: () => Promise.resolve(),
	showWarningMessage: () => Promise.resolve(),
	showInformationMessage: () => Promise.resolve(),
	createOutputChannel: () => ({
		appendLine: () => {},
		append: () => {},
		clear: () => {},
		show: () => {},
		dispose: () => {},
	}),
}

export const commands = {
	registerCommand: () => mockDisposable,
	executeCommand: () => Promise.resolve(),
}

export const languages = {
	createDiagnosticCollection: () => ({
		set: () => {},
		delete: () => {},
		clear: () => {},
		dispose: () => {},
	}),
}

export const extensions = {
	getExtension: () => null,
}

export const env = {
	openExternal: () => Promise.resolve(),
}

export const Uri = mockUri
export const Range = mockRange
export const Position = mockPosition
export const Selection = mockSelection
export const Disposable = mockDisposable

export const FileType = {
	File: 1,
	Directory: 2,
	SymbolicLink: 64,
}

export const DiagnosticSeverity = {
	Error: 0,
	Warning: 1,
	Information: 2,
	Hint: 3,
}

export const OverviewRulerLane = {
	Left: 1,
	Center: 2,
	Right: 4,
	Full: 7,
}

export const EventEmitter = mockEventEmitter

export default {
	workspace,
	window,
	commands,
	languages,
	extensions,
	env,
	Uri,
	Range,
	Position,
	Selection,
	Disposable,
	FileType,
	DiagnosticSeverity,
	OverviewRulerLane,
	EventEmitter,
}
