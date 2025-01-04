import { vi } from 'vitest';

// Mock VS Code API types
interface MockTerminalExitStatus {
  code: number | undefined;
  reason: number;
}

// Create base mock implementations
const createBaseEventEmitter = () => ({
  event: vi.fn(),
  fire: vi.fn(),
  dispose: vi.fn(),
});

const createBaseTerminal = (options: any) => ({
  name: options?.name || 'Mock Terminal',
  processId: Promise.resolve(1234),
  creationOptions: options,
  _exitStatus: undefined,
  state: { isInteractedWith: false },
  shellIntegration: undefined,
  sendText: vi.fn(),
  show: vi.fn(),
  hide: vi.fn(),
  dispose: vi.fn(),
});

// Mock the entire vscode module
const vscode = {
  EventEmitter: vi.fn().mockImplementation(() => createBaseEventEmitter()),
  ThemeIcon: vi.fn().mockImplementation((id: string) => ({ id })),
  workspace: {
    workspaceFolders: [],
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn(),
      update: vi.fn(),
      has: vi.fn(),
    }),
    onDidChangeConfiguration: vi.fn(),
    onDidChangeWorkspaceFolders: vi.fn(),
  },
  window: {
    terminals: [],
    createTerminal: vi.fn((options?: any) => {
      const terminal = createBaseTerminal(options);
      vscode.window.terminals.push(terminal);
      return terminal;
    }),
    onDidOpenTerminal: vi.fn(),
    onDidCloseTerminal: vi.fn(),
    onDidChangeTerminalState: vi.fn(),
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showQuickPick: vi.fn(),
    showInputBox: vi.fn(),
    createStatusBarItem: vi.fn(),
    activeTextEditor: undefined,
  },
  commands: {
    registerCommand: vi.fn(),
    executeCommand: vi.fn(),
    registerTextEditorCommand: vi.fn(),
    getCommands: vi.fn(),
  },
  languages: {
    registerHoverProvider: vi.fn(),
    registerCompletionItemProvider: vi.fn(),
    registerDefinitionProvider: vi.fn(),
  },
  Uri: {
    file: vi.fn((path: string) => ({ scheme: 'file', path })),
    parse: vi.fn(),
  },
  Position: vi.fn().mockImplementation((line: number, character: number) => ({
    line,
    character,
    translate: vi.fn(),
    with: vi.fn(),
    isAfter: vi.fn(),
    isBefore: vi.fn(),
    isEqual: vi.fn(),
    compareTo: vi.fn(),
  })),
  Range: vi.fn().mockImplementation((startLine: number, startChar: number, endLine: number, endChar: number) => ({
    start: new vscode.Position(startLine, startChar),
    end: new vscode.Position(endLine, endChar),
    isEmpty: vi.fn(),
    isSingleLine: vi.fn(),
    contains: vi.fn(),
    intersection: vi.fn(),
    union: vi.fn(),
  })),
  TerminalExitReason: {
    Unknown: 0,
    Shutdown: 1,
    Process: 2,
    User: 3,
    Extension: 4,
  } as const,
};

// Mock the vscode module
vi.mock('vscode', () => {
  return { default: vscode };
});

export { vscode };