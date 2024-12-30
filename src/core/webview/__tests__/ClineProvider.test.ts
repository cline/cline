import { ClineProvider } from '../ClineProvider'
import * as vscode from 'vscode'
import { ExtensionMessage, ExtensionState } from '../../../shared/ExtensionMessage'
import { setSoundEnabled } from '../../../utils/sound'

// Mock delay module
jest.mock('delay', () => {
    const delayFn = (ms: number) => Promise.resolve();
    delayFn.createDelay = () => delayFn;
    delayFn.reject = () => Promise.reject(new Error('Delay rejected'));
    delayFn.range = () => Promise.resolve();
    return delayFn;
});

// Mock MCP-related modules
jest.mock('@modelcontextprotocol/sdk/types.js', () => ({
    CallToolResultSchema: {},
    ListResourcesResultSchema: {},
    ListResourceTemplatesResultSchema: {},
    ListToolsResultSchema: {},
    ReadResourceResultSchema: {},
    ErrorCode: {
        InvalidRequest: 'InvalidRequest',
        MethodNotFound: 'MethodNotFound',
        InternalError: 'InternalError'
    },
    McpError: class McpError extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
            this.name = 'McpError';
        }
    }
}), { virtual: true });

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
    Client: jest.fn().mockImplementation(() => ({
        connect: jest.fn().mockResolvedValue(undefined),
        close: jest.fn().mockResolvedValue(undefined),
        listTools: jest.fn().mockResolvedValue({ tools: [] }),
        callTool: jest.fn().mockResolvedValue({ content: [] })
    }))
}), { virtual: true });

jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
    StdioClientTransport: jest.fn().mockImplementation(() => ({
        connect: jest.fn().mockResolvedValue(undefined),
        close: jest.fn().mockResolvedValue(undefined)
    }))
}), { virtual: true });

// Mock dependencies
jest.mock('vscode', () => ({
    ExtensionContext: jest.fn(),
    OutputChannel: jest.fn(),
    WebviewView: jest.fn(),
    Uri: {
        joinPath: jest.fn(),
        file: jest.fn()
    },
    workspace: {
        getConfiguration: jest.fn().mockReturnValue({
            get: jest.fn().mockReturnValue([]),
            update: jest.fn()
        }),
        onDidChangeConfiguration: jest.fn().mockImplementation((callback) => ({
            dispose: jest.fn()
        })),
        onDidSaveTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
        onDidChangeTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
        onDidOpenTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
        onDidCloseTextDocument: jest.fn(() => ({ dispose: jest.fn() }))
    },
    env: {
        uriScheme: 'vscode',
        language: 'en'
    }
}))

// Mock sound utility
jest.mock('../../../utils/sound', () => ({
    setSoundEnabled: jest.fn()
}))

// Mock ESM modules
jest.mock('p-wait-for', () => ({
    __esModule: true,
    default: jest.fn().mockResolvedValue(undefined)
}))

// Mock fs/promises
jest.mock('fs/promises', () => ({
    mkdir: jest.fn(),
    writeFile: jest.fn(),
    readFile: jest.fn(),
    unlink: jest.fn(),
    rmdir: jest.fn()
}))

// Mock axios
jest.mock('axios', () => ({
    get: jest.fn().mockResolvedValue({ data: { data: [] } }),
    post: jest.fn()
}))

// Mock buildApiHandler
jest.mock('../../../api', () => ({
    buildApiHandler: jest.fn()
}))

// Mock WorkspaceTracker
jest.mock('../../../integrations/workspace/WorkspaceTracker', () => {
    return jest.fn().mockImplementation(() => ({
        initializeFilePaths: jest.fn(),
        dispose: jest.fn()
    }))
})

// Mock Cline
jest.mock('../../Cline', () => {
    return {
        Cline: jest.fn().mockImplementation(() => ({
            abortTask: jest.fn(),
            handleWebviewAskResponse: jest.fn(),
            clineMessages: []
        }))
    }
})

// Mock extract-text
jest.mock('../../../integrations/misc/extract-text', () => ({
    extractTextFromFile: jest.fn().mockImplementation(async (filePath: string) => {
        const content = 'const x = 1;\nconst y = 2;\nconst z = 3;'
        const lines = content.split('\n')
        return lines.map((line, index) => `${index + 1} | ${line}`).join('\n')
    })
}))

// Spy on console.error and console.log to suppress expected messages
beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(console, 'log').mockImplementation(() => {})
})

afterAll(() => {
    jest.restoreAllMocks()
})

describe('ClineProvider', () => {
    let provider: ClineProvider
    let mockContext: vscode.ExtensionContext
    let mockOutputChannel: vscode.OutputChannel
    let mockWebviewView: vscode.WebviewView
    let mockPostMessage: jest.Mock
    let visibilityChangeCallback: (e?: unknown) => void

    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks()

        // Mock context
        mockContext = {
            extensionPath: '/test/path',
            extensionUri: {} as vscode.Uri,
            globalState: {
                get: jest.fn(),
                update: jest.fn(),
                keys: jest.fn().mockReturnValue([]),
            },
            secrets: {
                get: jest.fn(),
                store: jest.fn(),
                delete: jest.fn()
            },
            subscriptions: [],
            extension: {
                packageJSON: { version: '1.0.0' }
            },
            globalStorageUri: {
                fsPath: '/test/storage/path'
            }
        } as unknown as vscode.ExtensionContext

        // Mock output channel
        mockOutputChannel = {
            appendLine: jest.fn(),
            clear: jest.fn(),
            dispose: jest.fn()
        } as unknown as vscode.OutputChannel

        // Mock webview
        mockPostMessage = jest.fn()
        mockWebviewView = {
            webview: {
                postMessage: mockPostMessage,
                html: '',
                options: {},
                onDidReceiveMessage: jest.fn(),
                asWebviewUri: jest.fn()
            },
            visible: true,
            onDidDispose: jest.fn().mockImplementation((callback) => {
                callback()
                return { dispose: jest.fn() }
            }),
            onDidChangeVisibility: jest.fn().mockImplementation((callback) => {
                visibilityChangeCallback = callback
                return { dispose: jest.fn() }
            })
        } as unknown as vscode.WebviewView

        provider = new ClineProvider(mockContext, mockOutputChannel)
    })

    test('constructor initializes correctly', () => {
        expect(provider).toBeInstanceOf(ClineProvider)
        // Since getVisibleInstance returns the last instance where view.visible is true
        // @ts-ignore - accessing private property for testing
        provider.view = mockWebviewView
        expect(ClineProvider.getVisibleInstance()).toBe(provider)
    })

    test('resolveWebviewView sets up webview correctly', () => {
        provider.resolveWebviewView(mockWebviewView)
        
        expect(mockWebviewView.webview.options).toEqual({
            enableScripts: true,
            localResourceRoots: [mockContext.extensionUri]
        })
        expect(mockWebviewView.webview.html).toContain('<!DOCTYPE html>')
    })

    test('postMessageToWebview sends message to webview', async () => {
        provider.resolveWebviewView(mockWebviewView)
        
        const mockState: ExtensionState = {
            version: '1.0.0',
            preferredLanguage: 'English',
            clineMessages: [],
            taskHistory: [],
            shouldShowAnnouncement: false,
            apiConfiguration: {
                apiProvider: 'openrouter'
            },
            customInstructions: undefined,
            alwaysAllowReadOnly: false,
            alwaysAllowWrite: false,
            alwaysAllowExecute: false,
            alwaysAllowBrowser: false,
            alwaysAllowMcp: false,
            uriScheme: 'vscode',
            soundEnabled: false,
            diffEnabled: false,
            writeDelayMs: 1000,
            browserViewportSize: "900x600",
            fuzzyMatchThreshold: 1.0,
        }
        
        const message: ExtensionMessage = { 
            type: 'state', 
            state: mockState
        }
        await provider.postMessageToWebview(message)
        
        expect(mockPostMessage).toHaveBeenCalledWith(message)
    })

    test('handles webviewDidLaunch message', async () => {
        provider.resolveWebviewView(mockWebviewView)

        // Get the message handler from onDidReceiveMessage
        const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

        // Simulate webviewDidLaunch message
        await messageHandler({ type: 'webviewDidLaunch' })

        // Should post state and theme to webview
        expect(mockPostMessage).toHaveBeenCalled()
    })

    test('clearTask aborts current task', async () => {
        const mockAbortTask = jest.fn()
        // @ts-ignore - accessing private property for testing
        provider.cline = { abortTask: mockAbortTask }

        await provider.clearTask()

        expect(mockAbortTask).toHaveBeenCalled()
        // @ts-ignore - accessing private property for testing
        expect(provider.cline).toBeUndefined()
    })

    test('getState returns correct initial state', async () => {
        const state = await provider.getState()
        
        expect(state).toHaveProperty('apiConfiguration')
        expect(state.apiConfiguration).toHaveProperty('apiProvider')
        expect(state).toHaveProperty('customInstructions')
        expect(state).toHaveProperty('alwaysAllowReadOnly')
        expect(state).toHaveProperty('alwaysAllowWrite')
        expect(state).toHaveProperty('alwaysAllowExecute')
        expect(state).toHaveProperty('alwaysAllowBrowser')
        expect(state).toHaveProperty('taskHistory')
        expect(state).toHaveProperty('soundEnabled')
        expect(state).toHaveProperty('diffEnabled')
        expect(state).toHaveProperty('writeDelayMs')
    })

    test('preferredLanguage defaults to VSCode language when not set', async () => {
        // Mock VSCode language as Spanish
        (vscode.env as any).language = 'es-ES';
        
        const state = await provider.getState();
        expect(state.preferredLanguage).toBe('Spanish');
    })

    test('preferredLanguage defaults to English for unsupported VSCode language', async () => {
        // Mock VSCode language as an unsupported language
        (vscode.env as any).language = 'unsupported-LANG';
        
        const state = await provider.getState();
        expect(state.preferredLanguage).toBe('English');
    })

    test('diffEnabled defaults to true when not set', async () => {
        // Mock globalState.get to return undefined for diffEnabled
        (mockContext.globalState.get as jest.Mock).mockReturnValue(undefined)
        
        const state = await provider.getState()
        
        expect(state.diffEnabled).toBe(true)
    })

    test('writeDelayMs defaults to 1000ms', async () => {
        // Mock globalState.get to return undefined for writeDelayMs
        (mockContext.globalState.get as jest.Mock).mockImplementation((key: string) => {
            if (key === 'writeDelayMs') {
                return undefined
            }
            return null
        })
        
        const state = await provider.getState()
        expect(state.writeDelayMs).toBe(1000)
    })

    test('handles writeDelayMs message', async () => {
        provider.resolveWebviewView(mockWebviewView)
        const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]
        
        await messageHandler({ type: 'writeDelayMs', value: 2000 })
        
        expect(mockContext.globalState.update).toHaveBeenCalledWith('writeDelayMs', 2000)
        expect(mockPostMessage).toHaveBeenCalled()
    })

    test('updates sound utility when sound setting changes', async () => {
        provider.resolveWebviewView(mockWebviewView)

        // Get the message handler from onDidReceiveMessage
        const messageHandler = (mockWebviewView.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0]

        // Simulate setting sound to enabled
        await messageHandler({ type: 'soundEnabled', bool: true })
        expect(setSoundEnabled).toHaveBeenCalledWith(true)
        expect(mockContext.globalState.update).toHaveBeenCalledWith('soundEnabled', true)
        expect(mockPostMessage).toHaveBeenCalled()

        // Simulate setting sound to disabled
        await messageHandler({ type: 'soundEnabled', bool: false })
        expect(setSoundEnabled).toHaveBeenCalledWith(false)
        expect(mockContext.globalState.update).toHaveBeenCalledWith('soundEnabled', false)
        expect(mockPostMessage).toHaveBeenCalled()
    })

    test('file content includes line numbers', async () => {
        const { extractTextFromFile } = require('../../../integrations/misc/extract-text')
        const result = await extractTextFromFile('test.js')
        expect(result).toBe('1 | const x = 1;\n2 | const y = 2;\n3 | const z = 3;')
    })
})
