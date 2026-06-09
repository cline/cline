const noop = () => undefined

export const version = "test"
export const commands = { executeCommand: async () => undefined }
export const env = {
	clipboard: {
		readText: async () => "",
		writeText: async () => undefined,
	},
	openExternal: async () => true,
}
export const workspace = {
	workspaceFolders: [],
	getConfiguration: () => ({ get: noop, update: async () => undefined }),
	onDidChangeConfiguration: () => ({ dispose: noop }),
}
export const window = {
	activeTextEditor: undefined,
	visibleTextEditors: [],
	showInformationMessage: async () => undefined,
	showWarningMessage: async () => undefined,
	showErrorMessage: async () => undefined,
	createOutputChannel: () => ({ appendLine: noop, append: noop, show: noop, dispose: noop }),
	onDidChangeActiveTextEditor: () => ({ dispose: noop }),
	onDidChangeVisibleTextEditors: () => ({ dispose: noop }),
}

export class Position {
	constructor(
		public line = 0,
		public character = 0,
	) {}
}

export class Range {
	constructor(
		public start: Position = new Position(),
		public end: Position = new Position(),
	) {}
}

export class Selection extends Range {}
export class ThemeColor {
	constructor(public id: string) {}
}
export class ThemeIcon {
	constructor(public id: string) {}
}
export class Uri {
	static file(fsPath: string): Uri {
		return new Uri(fsPath)
	}
	static parse(value: string): Uri {
		return new Uri(value)
	}
	constructor(public fsPath: string) {}
	toString(): string {
		return this.fsPath
	}
}
export class CancellationTokenSource {
	dispose(): void {}
}
export class CancellationError extends Error {}
export class Disposable {
	constructor(public dispose: () => void = noop) {}
}
export class EventEmitter<T = unknown> {
	event = (_listener: (event: T) => void) => ({ dispose: noop })
	fire(_event: T): void {}
	dispose(): void {}
}
export class RelativePattern {
	constructor(
		public base: string,
		public pattern: string,
	) {}
}
export class MarkdownString {
	constructor(public value = "") {}
}

export const ExtensionKind = { UI: 1, Workspace: 2 }
export const ExtensionMode = { Production: 1, Development: 2, Test: 3 }
export const ColorThemeKind = { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 }
export const TaskRevealKind = { Always: 1, Silent: 2, Never: 3 }
export const TextEditorSelectionChangeKind = { Keyboard: 1, Mouse: 2, Command: 3 }
export const TextEditorCursorStyle = { Line: 1, Block: 2, Underline: 3, LineThin: 4, BlockOutline: 5, UnderlineThin: 6 }
export const TextEditorLineNumbersStyle = { Off: 0, On: 1, Relative: 2 }
export const TextEditorRevealType = { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 }
export const OverviewRulerLane = { Left: 1, Center: 2, Right: 4, Full: 7 }
export const DecorationRangeBehavior = { OpenOpen: 0, ClosedClosed: 1, OpenClosed: 2, ClosedOpen: 3 }
export const EndOfLine = { LF: 1, CRLF: 2 }
export const QuickPickItemKind = { Separator: -1, Default: 0 }
export const InputBoxValidationSeverity = { Info: 1, Warning: 2, Error: 3 }
export const CodeActionKind = { QuickFix: { value: "quickfix" } }
export const CodeActionTriggerKind = { Invoke: 1, Automatic: 2 }
export const DocumentHighlightKind = { Text: 0, Read: 1, Write: 2 }

export default {
	version,
	commands,
	env,
	workspace,
	window,
	Position,
	Range,
	Selection,
	ThemeColor,
	ThemeIcon,
	Uri,
	CancellationTokenSource,
	CancellationError,
	Disposable,
	EventEmitter,
	RelativePattern,
	MarkdownString,
	ExtensionKind,
	ExtensionMode,
	ColorThemeKind,
	TaskRevealKind,
	TextEditorSelectionChangeKind,
	TextEditorCursorStyle,
	TextEditorLineNumbersStyle,
	TextEditorRevealType,
	OverviewRulerLane,
	DecorationRangeBehavior,
	EndOfLine,
	QuickPickItemKind,
	InputBoxValidationSeverity,
	CodeActionKind,
	CodeActionTriggerKind,
	DocumentHighlightKind,
}
