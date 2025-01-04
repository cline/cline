import { vi } from 'vitest';
import { EventEmitter as NodeEventEmitter } from 'events';

// Mock VS Code API types
interface MockTerminalExitStatus {
  code: number | undefined;
  reason: number;
}

interface Disposable {
  dispose(): any;
}

interface CancellationToken {
  isCancellationRequested: boolean;
  onCancellationRequested: Event<any>;
}

interface OutputChannel {
  name: string;
  append(value: string): void;
  appendLine(value: string): void;
  clear(): void;
  show(): void;
  hide(): void;
  dispose(): void;
}

type Event<T> = (listener: (e: T) => any, thisArgs?: any, disposables?: Disposable[]) => Disposable;

// Create proper Event Emitter implementation
class VSCodeEventEmitter<T> {
  private listeners: ((e: T) => any)[] = [];

  constructor() {
    this.event = this.event.bind(this);
    this.fire = this.fire.bind(this);
    this.dispose = this.dispose.bind(this);
  }

  event(listener: (e: T) => any, thisArgs?: any, disposables?: Disposable[]): Disposable {
    this.listeners.push(listener);
    const disposable = {
      dispose: () => {
        const index = this.listeners.indexOf(listener);
        if (index > -1) {
          this.listeners.splice(index, 1);
        }
      }
    };
    if (disposables) {
      disposables.push(disposable);
    }
    return disposable;
  }

  fire(data: T): void {
    this.listeners.forEach(listener => listener(data));
  }

  dispose(): void {
    this.listeners = [];
  }
}

// Create base mock implementations
const createBaseEventEmitter = () => new VSCodeEventEmitter();

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
  EventEmitter: VSCodeEventEmitter,
  NodeEventEmitter,
  ThemeIcon: vi.fn().mockImplementation((id: string) => ({ id })),
  workspace: {
    workspaceFolders: [],
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn(),
      update: vi.fn(),
      has: vi.fn(),
    }),
    onDidChangeConfiguration: new VSCodeEventEmitter().event,
    onDidChangeWorkspaceFolders: new VSCodeEventEmitter().event,
  },
  window: {
    terminals: [],
    createTerminal: vi.fn((options?: any) => {
      const terminal = createBaseTerminal(options);
      vscode.window.terminals.push(terminal);
      return terminal;
    }),
    createOutputChannel: vi.fn((name: string): OutputChannel => ({
      name,
      append: vi.fn(),
      appendLine: vi.fn(),
      clear: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
    })),
    onDidOpenTerminal: new VSCodeEventEmitter().event,
    onDidCloseTerminal: new VSCodeEventEmitter().event,
    onDidChangeTerminalState: new VSCodeEventEmitter().event,
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showQuickPick: vi.fn(),
    showInputBox: vi.fn(),
    createStatusBarItem: vi.fn(),
    activeTextEditor: undefined,
    onDidChangeActiveTextEditor: new VSCodeEventEmitter().event,
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
    file: vi.fn((path: string) => ({ 
      scheme: 'file',
      path,
      fsPath: path,
      with: vi.fn(),
      toString: vi.fn(),
      toJSON: vi.fn(),
    })),
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
  CancellationTokenSource: class {
    token: CancellationToken;
    constructor() {
      const emitter = new VSCodeEventEmitter<void>();
      this.token = {
        isCancellationRequested: false,
        onCancellationRequested: emitter.event,
      };
    }
    cancel() {
      (this.token as any).isCancellationRequested = true;
    }
    dispose() {}
  },
};

// Mock the vscode module
vi.mock('vscode', () => {
  return { default: vscode };
});

export { vscode };