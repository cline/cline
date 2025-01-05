import { vi } from 'vitest'
import * as vscode from 'vscode'

vi.mock('vscode', async (importOriginal) => {
  const actualVscode = await importOriginal<typeof import('vscode')>()
  return {
    ...actualVscode,
    Uri: {
      ...actualVscode.Uri,
      joinPath: vi.fn().mockImplementation((base, ...pathSegments) => ({
        fsPath: `${base.fsPath}/${pathSegments.join('/')}`,
        scheme: base.scheme,
        authority: base.authority,
        path: `${base.path}/${pathSegments.join('/')}`,
      })),
    },
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
      executeCommand: vi.fn().mockImplementation(async <T>(command: string, ...rest: any[]): Promise<T | undefined> => undefined),
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
      createOutputChannel: vi.fn().mockImplementation((name: string, languageId?: string): vscode.OutputChannel => ({
        name,
        languageId: languageId ?? 'Log',
        append: vi.fn(),
        appendLine: vi.fn(),
        clear: vi.fn(),
        show: vi.fn(),
        hide: vi.fn(),
        dispose: vi.fn(),
      })),
      registerWebviewViewProvider: vi.fn().mockImplementation((viewId: string, provider: vscode.WebviewViewProvider, options?: vscode.WebviewViewOptions) => ({
        dispose: vi.fn(),
      })),
      registerUriHandler: vi.fn().mockImplementation((handler: vscode.UriHandler) => ({
        dispose: vi.fn(),
      })),
      createWebviewPanel: vi.fn().mockImplementation((viewType: string, title: string, showOptions: vscode.ViewColumn | { viewColumn: vscode.ViewColumn, preserveFocus?: boolean }, options?: vscode.WebviewPanelOptions) => ({
        webview: {
          html: '',
          onDidReceiveMessage: vi.fn(),
          postMessage: vi.fn(),
          asWebviewUri: vi.fn(),
        },
        reveal: vi.fn(),
        dispose: vi.fn(),
      })),
      showInformationMessage: vi.fn().mockResolvedValue(undefined),
      createTextEditorDecorationType: vi.fn().mockImplementation(() => ({
        dispose: vi.fn(),
        key: 'mock-decoration-type',
      })),
      onDidStartTerminalShellExecution: vi.fn(),
    },
    workspace: {
      ...actualVscode.workspace,
      registerTextDocumentContentProvider: vi.fn().mockImplementation((scheme: string, provider: vscode.TextDocumentContentProvider) => ({
        dispose: vi.fn(),
      })),
      onDidOpenTextDocument: vi.fn().mockImplementation(() => new vscode.EventEmitter<vscode.TextDocument>().event) as vscode.Event<vscode.TextDocument>,
      onDidCloseTextDocument: vi.fn().mockImplementation(() => new vscode.EventEmitter<vscode.TextDocument>().event) as vscode.Event<vscode.TextDocument>,
      onDidChangeTextDocument: vi.fn().mockImplementation(() => new vscode.EventEmitter<vscode.TextDocumentChangeEvent>().event) as vscode.Event<vscode.TextDocumentChangeEvent>,
      onWillSaveTextDocument: vi.fn().mockImplementation(() => new vscode.EventEmitter<vscode.TextDocumentWillSaveEvent>().event) as vscode.Event<vscode.TextDocumentWillSaveEvent>,
      onDidSaveTextDocument: vi.fn().mockImplementation(() => new vscode.EventEmitter<vscode.TextDocument>().event) as vscode.Event<vscode.TextDocument>,
      onDidCreateFiles: vi.fn().mockImplementation(() => new vscode.EventEmitter<vscode.FileCreateEvent>().event) as vscode.Event<vscode.FileCreateEvent>,
      onDidRenameFiles: vi.fn().mockImplementation(() => new vscode.EventEmitter<vscode.FileRenameEvent>().event) as vscode.Event<vscode.FileRenameEvent>,
      onDidDeleteFiles: vi.fn().mockImplementation(() => new vscode.EventEmitter<vscode.FileDeleteEvent>().event) as vscode.Event<vscode.FileDeleteEvent>,
      onDidChangeWorkspaceFolders: vi.fn().mockImplementation(() => new vscode.EventEmitter<vscode.WorkspaceFoldersChangeEvent>().event) as vscode.Event<vscode.WorkspaceFoldersChangeEvent>,
      workspaceFolders: [
        {
          uri: {
            scheme: 'file',
            path: '/path/to/mock/workspace',
            fsPath: '/path/to/mock/workspace',
          },
        },
      ],
    },
  }
})
