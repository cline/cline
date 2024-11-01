import { Cline } from '../Cline';
import { ClineProvider } from '../webview/ClineProvider';
import { ApiConfiguration } from '../../shared/api';
import * as vscode from 'vscode';

// Mock fileExistsAtPath
jest.mock('../../utils/fs', () => ({
    fileExistsAtPath: jest.fn().mockImplementation((filePath) => {
        return filePath.includes('ui_messages.json') || 
               filePath.includes('api_conversation_history.json');
    })
}));

// Mock fs/promises
const mockMessages = [{
    ts: Date.now(),
    type: 'say',
    say: 'text',
    text: 'historical task'
}];

jest.mock('fs/promises', () => ({
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn().mockImplementation((filePath) => {
        if (filePath.includes('ui_messages.json')) {
            return Promise.resolve(JSON.stringify(mockMessages));
        }
        if (filePath.includes('api_conversation_history.json')) {
            return Promise.resolve('[]');
        }
        return Promise.resolve('[]');
    }),
    unlink: jest.fn().mockResolvedValue(undefined),
    rmdir: jest.fn().mockResolvedValue(undefined)
}));

// Mock dependencies
jest.mock('vscode', () => {
    const mockDisposable = { dispose: jest.fn() };
    const mockEventEmitter = {
        event: jest.fn(),
        fire: jest.fn()
    };

    const mockTextDocument = {
        uri: {
            fsPath: '/mock/workspace/path/file.ts'
        }
    };

    const mockTextEditor = {
        document: mockTextDocument
    };

    const mockTab = {
        input: {
            uri: {
                fsPath: '/mock/workspace/path/file.ts'
            }
        }
    };

    const mockTabGroup = {
        tabs: [mockTab]
    };

    return {
        window: {
            createTextEditorDecorationType: jest.fn().mockReturnValue({
                dispose: jest.fn()
            }),
            visibleTextEditors: [mockTextEditor],
            tabGroups: {
                all: [mockTabGroup]
            }
        },
        workspace: {
            workspaceFolders: [{
                uri: {
                    fsPath: '/mock/workspace/path'
                },
                name: 'mock-workspace',
                index: 0
            }],
            onDidCreateFiles: jest.fn(() => mockDisposable),
            onDidDeleteFiles: jest.fn(() => mockDisposable),
            onDidRenameFiles: jest.fn(() => mockDisposable)
        },
        env: {
            uriScheme: 'vscode',
            language: 'en'
        },
        EventEmitter: jest.fn().mockImplementation(() => mockEventEmitter),
        Disposable: {
            from: jest.fn()
        },
        TabInputText: jest.fn()
    };
});

// Mock p-wait-for to resolve immediately
jest.mock('p-wait-for', () => ({
    __esModule: true,
    default: jest.fn().mockImplementation(async () => Promise.resolve())
}));

jest.mock('delay', () => ({
    __esModule: true,
    default: jest.fn().mockImplementation(async () => Promise.resolve())
}));

jest.mock('serialize-error', () => ({
    __esModule: true,
    serializeError: jest.fn().mockImplementation((error) => ({
        name: error.name,
        message: error.message,
        stack: error.stack
    }))
}));

jest.mock('strip-ansi', () => ({
    __esModule: true,
    default: jest.fn().mockImplementation((str) => str.replace(/\u001B\[\d+m/g, ''))
}));

jest.mock('globby', () => ({
    __esModule: true,
    globby: jest.fn().mockImplementation(async () => [])
}));

jest.mock('os-name', () => ({
    __esModule: true,
    default: jest.fn().mockReturnValue('Mock OS Name')
}));

jest.mock('default-shell', () => ({
    __esModule: true,
    default: '/bin/bash'  // Mock default shell path
}));

describe('Cline', () => {
    let mockProvider: jest.Mocked<ClineProvider>;
    let mockApiConfig: ApiConfiguration;
    let mockOutputChannel: any;
    let mockExtensionContext: vscode.ExtensionContext;
    
    beforeEach(() => {
        // Setup mock extension context
        mockExtensionContext = {
            globalState: {
                get: jest.fn().mockImplementation((key) => {
                    if (key === 'taskHistory') {
                        return [{
                            id: '123',
                            ts: Date.now(),
                            task: 'historical task',
                            tokensIn: 100,
                            tokensOut: 200,
                            cacheWrites: 0,
                            cacheReads: 0,
                            totalCost: 0.001
                        }];
                    }
                    return undefined;
                }),
                update: jest.fn().mockImplementation((key, value) => Promise.resolve()),
                keys: jest.fn().mockReturnValue([])
            },
            workspaceState: {
                get: jest.fn().mockImplementation((key) => undefined),
                update: jest.fn().mockImplementation((key, value) => Promise.resolve()),
                keys: jest.fn().mockReturnValue([])
            },
            secrets: {
                get: jest.fn().mockImplementation((key) => Promise.resolve(undefined)),
                store: jest.fn().mockImplementation((key, value) => Promise.resolve()),
                delete: jest.fn().mockImplementation((key) => Promise.resolve())
            },
            extensionUri: {
                fsPath: '/mock/extension/path'
            },
            globalStorageUri: {
                fsPath: '/mock/storage/path'
            },
            extension: {
                packageJSON: {
                    version: '1.0.0'
                }
            }
        } as unknown as vscode.ExtensionContext;

        // Setup mock output channel
        mockOutputChannel = {
            appendLine: jest.fn(),
            append: jest.fn(),
            clear: jest.fn(),
            show: jest.fn(),
            hide: jest.fn(),
            dispose: jest.fn()
        };

        // Setup mock provider with output channel
        mockProvider = new ClineProvider(mockExtensionContext, mockOutputChannel) as jest.Mocked<ClineProvider>;
        
        // Setup mock API configuration
        mockApiConfig = {
            apiProvider: 'anthropic',
            apiModelId: 'claude-3-sonnet'
        };

        // Mock provider methods
        mockProvider.postMessageToWebview = jest.fn().mockResolvedValue(undefined);
        mockProvider.postStateToWebview = jest.fn().mockResolvedValue(undefined);
        mockProvider.getTaskWithId = jest.fn().mockImplementation(async (id) => ({
            historyItem: {
                id,
                ts: Date.now(),
                task: 'historical task',
                tokensIn: 100,
                tokensOut: 200,
                cacheWrites: 0,
                cacheReads: 0,
                totalCost: 0.001
            },
            taskDirPath: '/mock/storage/path/tasks/123',
            apiConversationHistoryFilePath: '/mock/storage/path/tasks/123/api_conversation_history.json',
            uiMessagesFilePath: '/mock/storage/path/tasks/123/ui_messages.json',
            apiConversationHistory: []
        }));
    });

    describe('constructor', () => {
        it('should initialize with default settings', () => {
            const cline = new Cline(
                mockProvider,
                mockApiConfig,
                undefined, // customInstructions
                undefined, // alwaysAllowReadOnly
                undefined, // alwaysAllowWrite
                undefined, // alwaysAllowExecute
                'test task'
            );

            expect(cline.alwaysAllowReadOnly).toBe(false);
            expect(cline.alwaysAllowWrite).toBe(false);
            expect(cline.alwaysAllowExecute).toBe(false);
        });

        it('should respect provided settings', () => {
            const cline = new Cline(
                mockProvider,
                mockApiConfig,
                'custom instructions',
                true,  // alwaysAllowReadOnly
                true,  // alwaysAllowWrite
                true,  // alwaysAllowExecute
                'test task'
            );

            expect(cline.alwaysAllowReadOnly).toBe(true);
            expect(cline.alwaysAllowWrite).toBe(true);
            expect(cline.alwaysAllowExecute).toBe(true);
            expect(cline.customInstructions).toBe('custom instructions');
        });

        it('should require either task or historyItem', () => {
            expect(() => {
                new Cline(
                    mockProvider,
                    mockApiConfig
                );
            }).toThrow('Either historyItem or task/images must be provided');
        });
    });

    describe('file operations', () => {
        let cline: Cline;

        beforeEach(() => {
            cline = new Cline(
                mockProvider,
                mockApiConfig,
                undefined,
                false,
                false,
                false,
                'test task'
            );
        });

        it('should bypass approval when alwaysAllowWrite is true', async () => {
            const writeEnabledCline = new Cline(
                mockProvider,
                mockApiConfig,
                undefined,
                false,
                true,  // alwaysAllowWrite
                false,
                'test task'
            );

            expect(writeEnabledCline.alwaysAllowWrite).toBe(true);
            // The write operation would bypass approval in actual implementation
        });

        it('should require approval when alwaysAllowWrite is false', async () => {
            const writeDisabledCline = new Cline(
                mockProvider,
                mockApiConfig,
                undefined,
                false,
                false,  // alwaysAllowWrite
                false,
                'test task'
            );

            expect(writeDisabledCline.alwaysAllowWrite).toBe(false);
            // The write operation would require approval in actual implementation
        });
    });    
});
