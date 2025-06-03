// Comprehensive VSCode mock for unit tests

// Classes that need to be available
export class Position {
	constructor(
		public line: number,
		public character: number,
	) {}

	translate(lineDelta?: number, characterDelta?: number): Position {
		return new Position(this.line + (lineDelta || 0), this.character + (characterDelta || 0))
	}

	with(line?: number, character?: number): Position {
		return new Position(line ?? this.line, character ?? this.character)
	}

	isAfter(other: Position): boolean {
		return this.line > other.line || (this.line === other.line && this.character > other.character)
	}

	isAfterOrEqual(other: Position): boolean {
		return this.line > other.line || (this.line === other.line && this.character >= other.character)
	}

	isBefore(other: Position): boolean {
		return !this.isAfterOrEqual(other)
	}

	isBeforeOrEqual(other: Position): boolean {
		return !this.isAfter(other)
	}

	isEqual(other: Position): boolean {
		return this.line === other.line && this.character === other.character
	}

	compareTo(other: Position): number {
		if (this.line < other.line) {
			return -1
		}
		if (this.line > other.line) {
			return 1
		}
		if (this.character < other.character) {
			return -1
		}
		if (this.character > other.character) {
			return 1
		}
		return 0
	}
}

export class Range {
	constructor(
		public start: Position | number,
		public end: Position | number,
		endLine?: number,
		endCharacter?: number,
	) {
		if (typeof start === "number" && typeof end === "number") {
			this.start = new Position(start, end)
			this.end = new Position(endLine || start, endCharacter ?? Number.MAX_SAFE_INTEGER)
		} else if (start instanceof Position && end instanceof Position) {
			this.start = start
			this.end = end
		} else {
			this.start = new Position(0, 0)
			this.end = new Position(0, 0)
		}
	}

	get isEmpty(): boolean {
		return (this.start as Position).isEqual(this.end as Position)
	}

	get isSingleLine(): boolean {
		return (this.start as Position).line === (this.end as Position).line
	}

	contains(positionOrRange: Position | Range): boolean {
		if (positionOrRange instanceof Range) {
			return this.contains(positionOrRange.start as Position) && this.contains(positionOrRange.end as Position)
		}
		return (this.start as Position).isBeforeOrEqual(positionOrRange) && (this.end as Position).isAfterOrEqual(positionOrRange)
	}

	isEqual(other: Range): boolean {
		return (this.start as Position).isEqual(other.start as Position) && (this.end as Position).isEqual(other.end as Position)
	}

	intersection(other: Range): Range | undefined {
		const start = (this.start as Position).isAfter(other.start as Position) ? this.start : other.start
		const end = (this.end as Position).isBefore(other.end as Position) ? this.end : other.end
		if ((start as Position).isAfter(end as Position)) {
			return undefined
		}
		return new Range(start as Position, end as Position)
	}

	union(other: Range): Range {
		const start = (this.start as Position).isBefore(other.start as Position) ? this.start : other.start
		const end = (this.end as Position).isAfter(other.end as Position) ? this.end : other.end
		return new Range(start as Position, end as Position)
	}

	with(start?: Position, end?: Position): Range {
		return new Range(start || (this.start as Position), end || (this.end as Position))
	}
}

export class Selection extends Range {
	constructor(
		public anchor: Position | number,
		public active: Position | number,
		activeLine?: number,
		activeCharacter?: number,
	) {
		if (typeof anchor === "number" && typeof active === "number") {
			const anchorPos = new Position(anchor, active)
			const activePos = new Position(activeLine || anchor, activeCharacter || active)
			super(anchorPos, activePos)
			this.anchor = anchorPos
			this.active = activePos
		} else {
			super(anchor as Position, active as Position)
		}
	}

	get isReversed(): boolean {
		return (this.anchor as Position).isAfter(this.active as Position)
	}
}

export const env = {
	machineId: "test-machine-id",
	appRoot: "mock/app/root",
	appName: "VSCode",
	appHost: "desktop",
	language: "en",
	sessionId: "test-session-id",
	remoteName: undefined,
	shell: "/bin/bash",
	uriScheme: "vscode",
	clipboard: {
		readText: async () => "",
		writeText: async (text: string) => {},
	},
	openExternal: async (uri: any) => true,
	asExternalUri: async (uri: any) => uri,
	logLevel: 1,
	isTelemetryEnabled: true,
	onDidChangeTelemetryEnabled: (listener: any) => ({ dispose: () => {} }),
}

export const workspace = {
	getConfiguration: (section?: string) => ({
		get: (key: string, defaultValue?: any) => defaultValue,
		has: (key: string) => false,
		inspect: (key: string) => undefined,
		update: async (key: string, value: any, target?: any) => {},
	}),
	workspaceFolders: [],
	name: undefined,
	rootPath: undefined,
	onDidChangeConfiguration: (listener: any) => ({ dispose: () => {} }),
	onDidChangeWorkspaceFolders: (listener: any) => ({ dispose: () => {} }),
	onDidOpenTextDocument: (listener: any) => ({ dispose: () => {} }),
	onDidCloseTextDocument: (listener: any) => ({ dispose: () => {} }),
	onDidChangeTextDocument: (listener: any) => ({ dispose: () => {} }),
	onDidSaveTextDocument: (listener: any) => ({ dispose: () => {} }),
	onWillSaveTextDocument: (listener: any) => ({ dispose: () => {} }),
	onDidCreateFiles: (listener: any) => ({ dispose: () => {} }),
	onDidDeleteFiles: (listener: any) => ({ dispose: () => {} }),
	onDidRenameFiles: (listener: any) => ({ dispose: () => {} }),
	fs: {
		readFile: async (uri: any) => Buffer.from(""),
		writeFile: async (uri: any, content: any) => {},
		delete: async (uri: any) => {},
		createDirectory: async (uri: any) => {},
		readDirectory: async (uri: any) => [],
		stat: async (uri: any) => ({ type: 1, ctime: 0, mtime: 0, size: 0 }),
		rename: async (oldUri: any, newUri: any) => {},
		copy: async (source: any, destination: any) => {},
	},
	openTextDocument: async (uri: any) => ({
		uri: { scheme: "file", path: "/mock/file.txt", toString: () => "/mock/file.txt" },
		fileName: "/mock/file.txt",
		isUntitled: false,
		languageId: "plaintext",
		version: 1,
		isDirty: false,
		isClosed: false,
		eol: 1,
		lineCount: 1,
		lineAt: (line: number) => ({
			lineNumber: line,
			text: "",
			range: new Range(new Position(line, 0), new Position(line, 0)),
			rangeIncludingLineBreak: new Range(new Position(line, 0), new Position(line + 1, 0)),
			firstNonWhitespaceCharacterIndex: 0,
			isEmptyOrWhitespace: true,
		}),
		offsetAt: (position: any) => 0,
		positionAt: (offset: number) => new Position(0, 0),
		getText: (range?: any) => "",
		getWordRangeAtPosition: (position: any, regex?: RegExp) => undefined,
		validateRange: (range: any) => range,
		validatePosition: (position: any) => position,
		save: async () => true,
	}),
	saveAll: async (includeUntitled?: boolean) => true,
	applyEdit: async (edit: any) => true,
	createFileSystemWatcher: (globPattern: any) => ({
		onDidCreate: (listener: any) => ({ dispose: () => {} }),
		onDidChange: (listener: any) => ({ dispose: () => {} }),
		onDidDelete: (listener: any) => ({ dispose: () => {} }),
		dispose: () => {},
	}),
	findFiles: async (include: any, exclude?: any, maxResults?: number, token?: any) => [],
	getWorkspaceFolder: (uri: any) => undefined,
	asRelativePath: (pathOrUri: any, includeWorkspaceFolder?: boolean) => "",
	updateWorkspaceFolders: (start: number, deleteCount: number, ...workspaceFoldersToAdd: any[]) => true,
	textDocuments: [],
	notebookDocuments: [],
	isTrusted: true,
	onDidGrantWorkspaceTrust: (listener: any) => ({ dispose: () => {} }),
}

export const window = {
	showInformationMessage: async (message: string, ...items: any[]) => undefined,
	showWarningMessage: async (message: string, ...items: any[]) => undefined,
	showErrorMessage: async (message: string, ...items: any[]) => undefined,
	showQuickPick: async (items: any[], options?: any) => undefined,
	showInputBox: async (options?: any) => undefined,
	showOpenDialog: async (options?: any) => undefined,
	showSaveDialog: async (options?: any) => undefined,
	showWorkspaceFolderPick: async (options?: any) => undefined,
	createOutputChannel: (name: string, languageId?: string) => ({
		name,
		append: (value: string) => {},
		appendLine: (value: string) => {},
		clear: () => {},
		dispose: () => {},
		hide: () => {},
		show: (preserveFocus?: boolean) => {},
		replace: (value: string) => {},
	}),
	createWebviewPanel: (viewType: string, title: string, showOptions: any, options?: any) => ({
		webview: {
			html: "",
			options: {},
			asWebviewUri: (uri: any) => uri,
			postMessage: async (message: any) => true,
			onDidReceiveMessage: (listener: any) => ({ dispose: () => {} }),
			cspSource: "mock-csp-source",
		},
		title: title,
		viewType: viewType,
		visible: true,
		active: true,
		viewColumn: undefined,
		options: options || {},
		dispose: () => {},
		reveal: (viewColumn?: any, preserveFocus?: boolean) => {},
		onDidDispose: (listener: any) => ({ dispose: () => {} }),
		onDidChangeViewState: (listener: any) => ({ dispose: () => {} }),
	}),
	createTextEditorDecorationType: (options: any) => ({
		key: "mock-decoration-type",
		dispose: () => {},
	}),
	createStatusBarItem: (alignment?: any, priority?: number) => ({
		alignment: alignment || 1,
		priority: priority || 0,
		text: "",
		tooltip: "",
		color: undefined,
		backgroundColor: undefined,
		command: undefined,
		accessibilityInformation: undefined,
		show: () => {},
		hide: () => {},
		dispose: () => {},
	}),
	createTerminal: (options?: any) => ({
		name: options?.name || "mock-terminal",
		processId: Promise.resolve(1234),
		creationOptions: options || {},
		exitStatus: undefined,
		state: { isInteractedWith: false },
		sendText: (text: string, addNewLine?: boolean) => {},
		show: (preserveFocus?: boolean) => {},
		hide: () => {},
		dispose: () => {},
	}),
	createTreeView: (viewId: string, options: any) => ({
		visible: true,
		selection: [],
		onDidExpandElement: (listener: any) => ({ dispose: () => {} }),
		onDidCollapseElement: (listener: any) => ({ dispose: () => {} }),
		onDidChangeSelection: (listener: any) => ({ dispose: () => {} }),
		onDidChangeVisibility: (listener: any) => ({ dispose: () => {} }),
		reveal: async (element: any, options?: any) => {},
		dispose: () => {},
	}),
	registerWebviewPanelSerializer: (viewType: string, serializer: any) => ({ dispose: () => {} }),
	registerWebviewViewProvider: (viewId: string, provider: any, options?: any) => ({ dispose: () => {} }),
	registerTreeDataProvider: (viewId: string, treeDataProvider: any) => ({ dispose: () => {} }),
	registerUriHandler: (handler: any) => ({ dispose: () => {} }),
	registerFileDecorationProvider: (provider: any) => ({ dispose: () => {} }),
	activeTextEditor: undefined,
	visibleTextEditors: [],
	onDidChangeActiveTextEditor: (listener: any) => ({ dispose: () => {} }),
	onDidChangeVisibleTextEditors: (listener: any) => ({ dispose: () => {} }),
	onDidChangeTextEditorSelection: (listener: any) => ({ dispose: () => {} }),
	onDidChangeTextEditorVisibleRanges: (listener: any) => ({ dispose: () => {} }),
	onDidChangeTextEditorOptions: (listener: any) => ({ dispose: () => {} }),
	onDidChangeTextEditorViewColumn: (listener: any) => ({ dispose: () => {} }),
	onDidCloseTerminal: (listener: any) => ({ dispose: () => {} }),
	onDidOpenTerminal: (listener: any) => ({ dispose: () => {} }),
	onDidChangeActiveTerminal: (listener: any) => ({ dispose: () => {} }),
	onDidChangeTerminalState: (listener: any) => ({ dispose: () => {} }),
	terminals: [],
	activeTerminal: undefined,
	state: {
		focused: true,
	},
	onDidChangeWindowState: (listener: any) => ({ dispose: () => {} }),
	showTextDocument: async (document: any, options?: any) => ({
		document,
		selection: new Selection(0, 0, 0, 0),
		selections: [new Selection(0, 0, 0, 0)],
		visibleRanges: [new Range(0, 0, 10, 0)],
		options: {},
		viewColumn: 1,
		edit: async (callback: any) => true,
		insertSnippet: async (snippet: any, location?: any) => true,
		setDecorations: (decorationType: any, rangesOrOptions: any) => {},
		revealRange: (range: any, revealType?: any) => {},
		hide: () => {},
		show: (column?: any) => {},
	}),
	withProgress: async (options: any, task: any) => {
		return task({ report: () => {} }, { isCancellationRequested: false })
	},
	withScmProgress: async (task: any) => task({ isCancellationRequested: false }),
	setStatusBarMessage: (text: string, hideAfterTimeout?: number) => ({ dispose: () => {} }),
	createQuickPick: () => ({
		value: "",
		placeholder: undefined,
		items: [],
		canSelectMany: false,
		onDidChangeValue: (listener: any) => ({ dispose: () => {} }),
		onDidAccept: (listener: any) => ({ dispose: () => {} }),
		onDidHide: (listener: any) => ({ dispose: () => {} }),
		show: () => {},
		hide: () => {},
		dispose: () => {},
	}),
	createInputBox: () => ({
		value: "",
		placeholder: undefined,
		password: false,
		onDidChangeValue: (listener: any) => ({ dispose: () => {} }),
		onDidAccept: (listener: any) => ({ dispose: () => {} }),
		onDidHide: (listener: any) => ({ dispose: () => {} }),
		show: () => {},
		hide: () => {},
		dispose: () => {},
	}),
	tabGroups: {
		all: [],
		activeTabGroup: {
			isActive: true,
			viewColumn: 1,
			activeTab: undefined,
			tabs: [],
		},
		onDidChangeTabGroups: (listener: any) => ({ dispose: () => {} }),
		onDidChangeTabs: (listener: any) => ({ dispose: () => {} }),
		close: async (tab: any) => true,
	},
}

export const commands = {
	executeCommand: async (command: string, ...args: any[]) => undefined,
	registerCommand: (command: string, callback: (...args: any[]) => any) => ({ dispose: () => {} }),
	registerTextEditorCommand: (command: string, callback: (textEditor: any, edit: any, ...args: any[]) => void) => ({
		dispose: () => {},
	}),
	getCommands: async (filterInternal?: boolean) => [],
}

export const Uri = {
	parse: (value: string) => ({
		scheme: "file",
		authority: "",
		path: value,
		query: "",
		fragment: "",
		fsPath: value,
		with: (change: any) => Uri.parse(value),
		toString: () => value,
	}),
	file: (path: string) => ({
		scheme: "file",
		authority: "",
		path,
		query: "",
		fragment: "",
		fsPath: path,
		with: (change: any) => Uri.file(path),
		toString: () => path,
	}),
	joinPath: (base: any, ...paths: string[]) => ({
		scheme: "file",
		authority: "",
		path: [base.path, ...paths].join("/"),
		query: "",
		fragment: "",
		fsPath: [base.path, ...paths].join("/"),
		with: (change: any) => Uri.file([base.path, ...paths].join("/")),
		toString: () => [base.path, ...paths].join("/"),
	}),
	from: (components: any) => Uri.parse(components.path || ""),
}

export const languages = {
	registerCompletionItemProvider: (selector: any, provider: any, ...triggerCharacters: string[]) => ({ dispose: () => {} }),
	registerCodeActionsProvider: (selector: any, provider: any, metadata?: any) => ({ dispose: () => {} }),
	registerCodeLensProvider: (selector: any, provider: any) => ({ dispose: () => {} }),
	registerDefinitionProvider: (selector: any, provider: any) => ({ dispose: () => {} }),
	registerImplementationProvider: (selector: any, provider: any) => ({ dispose: () => {} }),
	registerTypeDefinitionProvider: (selector: any, provider: any) => ({ dispose: () => {} }),
	registerHoverProvider: (selector: any, provider: any) => ({ dispose: () => {} }),
	registerDocumentHighlightProvider: (selector: any, provider: any) => ({ dispose: () => {} }),
	registerDocumentSymbolProvider: (selector: any, provider: any, metadata?: any) => ({ dispose: () => {} }),
	registerWorkspaceSymbolProvider: (provider: any) => ({ dispose: () => {} }),
	registerReferenceProvider: (selector: any, provider: any) => ({ dispose: () => {} }),
	registerRenameProvider: (selector: any, provider: any) => ({ dispose: () => {} }),
	registerDocumentFormattingEditProvider: (selector: any, provider: any) => ({ dispose: () => {} }),
	registerDocumentRangeFormattingEditProvider: (selector: any, provider: any) => ({ dispose: () => {} }),
	registerOnTypeFormattingEditProvider: (
		selector: any,
		provider: any,
		firstTriggerCharacter: string,
		...moreTriggerCharacters: string[]
	) => ({ dispose: () => {} }),
	registerSignatureHelpProvider: (selector: any, provider: any, ...triggerCharacters: string[]) => ({ dispose: () => {} }),
	registerDocumentLinkProvider: (selector: any, provider: any) => ({ dispose: () => {} }),
	registerColorProvider: (selector: any, provider: any) => ({ dispose: () => {} }),
	registerFoldingRangeProvider: (selector: any, provider: any) => ({ dispose: () => {} }),
	registerDeclarationProvider: (selector: any, provider: any) => ({ dispose: () => {} }),
	registerSelectionRangeProvider: (selector: any, provider: any) => ({ dispose: () => {} }),
	registerCallHierarchyProvider: (selector: any, provider: any) => ({ dispose: () => {} }),
	registerDocumentSemanticTokensProvider: (selector: any, provider: any, legend: any) => ({ dispose: () => {} }),
	registerDocumentRangeSemanticTokensProvider: (selector: any, provider: any, legend: any) => ({ dispose: () => {} }),
	registerEvaluatableExpressionProvider: (selector: any, provider: any) => ({ dispose: () => {} }),
	registerInlineValuesProvider: (selector: any, provider: any) => ({ dispose: () => {} }),
	registerLinkedEditingRangeProvider: (selector: any, provider: any) => ({ dispose: () => {} }),
	createDiagnosticCollection: (name?: string) => ({
		name: name || "mock-diagnostics",
		set: (entries: any) => {},
		delete: (uri: any) => {},
		clear: () => {},
		forEach: (callback: any) => {},
		get: (uri: any) => undefined,
		has: (uri: any) => false,
		dispose: () => {},
	}),
	getDiagnostics: (resource?: any) => [],
	onDidChangeDiagnostics: (listener: any) => ({ dispose: () => {} }),
	getLanguages: async () => [],
	setTextDocumentLanguage: async (document: any, languageId: string) => document,
	match: (selector: any, document: any) => 0,
	setLanguageConfiguration: (language: string, configuration: any) => ({ dispose: () => {} }),
}

export const extensions = {
	getExtension: (extensionId: string) => undefined,
	all: [],
	onDidChange: (listener: any) => ({ dispose: () => {} }),
}

export class EventEmitter {
	event = (listener: any) => ({ dispose: () => {} })
	fire = (data: any) => {}
	dispose = () => {}
}

export const CancellationToken = {
	None: { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) },
}

export class CancellationTokenSource {
	token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) }
	cancel = () => {}
	dispose = () => {}
}

export class Disposable {
	static from(...disposables: any[]) {
		return new Disposable(() => {
			disposables.forEach((d) => d?.dispose?.())
		})
	}

	constructor(private callOnDispose: () => void) {}

	dispose() {
		this.callOnDispose()
	}
}

// Enums
export enum ViewColumn {
	Active = -1,
	Beside = -2,
	One = 1,
	Two = 2,
	Three = 3,
	Four = 4,
	Five = 5,
	Six = 6,
	Seven = 7,
	Eight = 8,
	Nine = 9,
}

export enum DiagnosticSeverity {
	Error = 0,
	Warning = 1,
	Information = 2,
	Hint = 3,
}

export enum ExtensionMode {
	Production = 1,
	Development = 2,
	Test = 3,
}

export enum ConfigurationTarget {
	Global = 1,
	Workspace = 2,
	WorkspaceFolder = 3,
}

export enum StatusBarAlignment {
	Left = 1,
	Right = 2,
}

export enum TextEditorRevealType {
	Default = 0,
	InCenter = 1,
	InCenterIfOutsideViewport = 2,
	AtTop = 3,
}

export enum OverviewRulerLane {
	Left = 1,
	Center = 2,
	Right = 4,
	Full = 7,
}

export enum DecorationRangeBehavior {
	OpenOpen = 0,
	ClosedClosed = 1,
	OpenClosed = 2,
	ClosedOpen = 3,
}

export enum FileType {
	Unknown = 0,
	File = 1,
	Directory = 2,
	SymbolicLink = 64,
}

export enum EndOfLine {
	LF = 1,
	CRLF = 2,
}

export enum EnvironmentVariableMutatorType {
	Replace = 1,
	Append = 2,
	Prepend = 3,
}

export enum UIKind {
	Desktop = 1,
	Web = 2,
}

export enum ColorThemeKind {
	Light = 1,
	Dark = 2,
	HighContrast = 3,
	HighContrastLight = 4,
}

export enum SourceControlInputBoxValidationType {
	Error = 0,
	Warning = 1,
	Information = 2,
}

// Additional mock utilities
export const version = "1.0.0"

export const tasks = {
	registerTaskProvider: (type: string, provider: any) => ({ dispose: () => {} }),
	executeTask: async (task: any) => ({
		terminate: () => {},
	}),
	fetchTasks: async (filter?: any) => [],
	taskExecutions: [],
	onDidStartTask: (listener: any) => ({ dispose: () => {} }),
	onDidEndTask: (listener: any) => ({ dispose: () => {} }),
	onDidStartTaskProcess: (listener: any) => ({ dispose: () => {} }),
	onDidEndTaskProcess: (listener: any) => ({ dispose: () => {} }),
}

export const debug = {
	activeDebugSession: undefined,
	activeDebugConsole: {
		append: (value: string) => {},
		appendLine: (value: string) => {},
	},
	breakpoints: [],
	onDidChangeActiveDebugSession: (listener: any) => ({ dispose: () => {} }),
	onDidStartDebugSession: (listener: any) => ({ dispose: () => {} }),
	onDidReceiveDebugSessionCustomEvent: (listener: any) => ({ dispose: () => {} }),
	onDidTerminateDebugSession: (listener: any) => ({ dispose: () => {} }),
	onDidChangeBreakpoints: (listener: any) => ({ dispose: () => {} }),
	registerDebugConfigurationProvider: (debugType: string, provider: any, triggerKind?: any) => ({ dispose: () => {} }),
	registerDebugAdapterDescriptorFactory: (debugType: string, factory: any) => ({ dispose: () => {} }),
	registerDebugAdapterTrackerFactory: (debugType: string, factory: any) => ({ dispose: () => {} }),
	startDebugging: async (folder: any, nameOrConfig: any, parentSessionOrOptions?: any) => true,
	stopDebugging: async (session?: any) => {},
	addBreakpoints: (breakpoints: any[]) => {},
	removeBreakpoints: (breakpoints: any[]) => {},
}

export const scm = {
	createSourceControl: (id: string, label: string, rootUri?: any) => ({
		id,
		label,
		rootUri,
		inputBox: {
			value: "",
			placeholder: undefined,
			enabled: true,
			visible: true,
			onDidChange: (listener: any) => ({ dispose: () => {} }),
		},
		count: 0,
		quickDiffProvider: undefined,
		commitTemplate: undefined,
		acceptInputCommand: undefined,
		statusBarCommands: [],
		createResourceGroup: (id: string, label: string) => ({
			id,
			label,
			resourceStates: [],
			dispose: () => {},
		}),
		dispose: () => {},
	}),
	inputBox: undefined,
}

export const comments = {
	createCommentController: (id: string, label: string) => ({
		id,
		label,
		commentingRangeProvider: undefined,
		createCommentThread: (uri: any, range: any, comments: any[]) => ({
			uri,
			range,
			comments,
			collapsibleState: 0,
			canReply: true,
			contextValue: undefined,
			label: undefined,
			dispose: () => {},
		}),
		dispose: () => {},
	}),
}

export const authentication = {
	getSession: async (providerId: string, scopes: string[], options?: any) => undefined,
	onDidChangeSessions: (listener: any) => ({ dispose: () => {} }),
	registerAuthenticationProvider: (id: string, label: string, provider: any, options?: any) => ({ dispose: () => {} }),
}

export const tests = {
	createTestController: (id: string, label: string) => ({
		id,
		label,
		items: {
			add: (item: any) => {},
			delete: (id: string) => {},
			get: (id: string) => undefined,
			forEach: (callback: any) => {},
			replace: (items: any[]) => {},
			size: 0,
		},
		createRunProfile: (label: string, group: any, runHandler: any, isDefault?: boolean) => ({
			label,
			group,
			isDefault,
			configureHandler: undefined,
			dispose: () => {},
		}),
		createTestItem: (id: string, label: string, uri?: any) => ({
			id,
			label,
			uri,
			children: {
				add: (item: any) => {},
				delete: (id: string) => {},
				get: (id: string) => undefined,
				forEach: (callback: any) => {},
				replace: (items: any[]) => {},
				size: 0,
			},
			parent: undefined,
			tags: [],
			canResolveChildren: false,
			busy: false,
			range: undefined,
			error: undefined,
		}),
		createTestRun: (request: any, name?: string, persist?: boolean) => ({
			name,
			token: { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) },
			isPersisted: persist || false,
			enqueued: (test: any) => {},
			started: (test: any) => {},
			skipped: (test: any) => {},
			failed: (test: any, message: any, duration?: number) => {},
			errored: (test: any, message: any, duration?: number) => {},
			passed: (test: any, duration?: number) => {},
			appendOutput: (output: string) => {},
			end: () => {},
		}),
		dispose: () => {},
	}),
}

// Default export for backward compatibility
export default {
	Position,
	Range,
	Selection,
	env,
	workspace,
	window,
	commands,
	Uri,
	languages,
	extensions,
	EventEmitter,
	CancellationToken,
	CancellationTokenSource,
	Disposable,
	ViewColumn,
	DiagnosticSeverity,
	ExtensionMode,
	ConfigurationTarget,
	StatusBarAlignment,
	TextEditorRevealType,
	OverviewRulerLane,
	DecorationRangeBehavior,
	FileType,
	EndOfLine,
	EnvironmentVariableMutatorType,
	UIKind,
	ColorThemeKind,
	SourceControlInputBoxValidationType,
	version,
	tasks,
	debug,
	scm,
	comments,
	authentication,
	tests,
}
