import { vi, beforeEach, Mock } from 'vitest';
import { TextDecoder, TextEncoder } from 'util';

// Polyfill for TextEncoder and TextDecoder in Node.js environment
global.TextEncoder = TextEncoder as typeof global.TextEncoder;
global.TextDecoder = TextDecoder as typeof global.TextDecoder;

// Create a more robust mock event system
interface MockEvent extends Mock {
  on: Mock;
  event: Mock;
  dispose: Mock;
}

const createMockEvent = (): MockEvent => {
  const mockEvent = vi.fn() as unknown as MockEvent;
  mockEvent.on = vi.fn(() => ({ dispose: vi.fn() }));
  mockEvent.event = vi.fn(() => ({ dispose: vi.fn() }));
  mockEvent.dispose = vi.fn();
  return mockEvent;
};

// Comprehensive VSCode API Mock
vi.mock('vscode', () => {
  // Create mock implementations for various VSCode constructs
  const mockExtensions = {
    getExtension: vi.fn().mockReturnValue({
      id: 'test.extension',
      isActive: true,
      exports: {},
      activate: vi.fn()
    })
  };

  const mockCommands = {
    registerCommand: vi.fn((command, callback) => ({
      dispose: vi.fn()
    })),
    executeCommand: vi.fn()
  };

  const mockWorkspace = {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn(),
      update: vi.fn()
    }),
    onDidChangeConfiguration: createMockEvent(),
    onDidChangeTextDocument: createMockEvent(),
    onDidSaveTextDocument: createMockEvent(),
    workspaceFolders: [],
    fs: {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      delete: vi.fn()
    }
  };

  const mockWindow = {
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    createOutputChannel: vi.fn().mockReturnValue({
      appendLine: vi.fn().mockImplementation((text) => console.log(text)),
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn()
    }),
    activeTextEditor: null,
    onDidChangeActiveTextEditor: createMockEvent(),
    createTextEditorDecorationType: vi.fn().mockReturnValue({
      dispose: vi.fn()
    })
  };

  return {
    // Main VSCode API mock objects
    extensions: mockExtensions,
    commands: mockCommands,
    workspace: mockWorkspace,
    window: mockWindow,
    
    // Context and environment mocks
    ExtensionContext: vi.fn().mockReturnValue({
      subscriptions: [],
      workspaceState: {
        get: vi.fn(),
        update: vi.fn()
      },
      globalState: {
        get: vi.fn(),
        update: vi.fn()
      },
      extensionPath: '/mock/extension/path',
      asAbsolutePath: vi.fn(),
      storagePath: '/mock/storage/path',
      globalStoragePath: '/mock/global/storage/path',
      logPath: '/mock/log/path',
      extensionUri: { fsPath: '/mock/extension/uri' },
      storageUri: { fsPath: '/mock/storage/uri' },
      globalStorageUri: { fsPath: '/mock/global/storage/uri' },
      logUri: { fsPath: '/mock/log/uri' },
      environmentVariableCollection: {
        replace: vi.fn(),
        append: vi.fn(),
        delete: vi.fn(),
        clear: vi.fn()
      }
    }),
    
    // Additional utility mocks
    env: {
      language: 'en',
      appName: 'VSCode',
      machineId: 'test-machine-id'
    },
    
    // Event and URI utilities
    EventEmitter: vi.fn().mockReturnValue({
      fire: vi.fn(),
      event: vi.fn(() => ({ dispose: vi.fn() }))
    }),
    Uri: {
      file: vi.fn().mockReturnValue({
        fsPath: '/mock/file/path',
        path: '/mock/file/path',
        scheme: 'file'
      }),
      parse: vi.fn()
    }
  };
});

// Reset all mocks before each test
beforeEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});
