import { Cline } from '../Cline';
import { ClineProvider } from '../webview/ClineProvider';
import { ApiConfiguration } from '../../shared/api';
import { ApiStreamChunk } from '../../api/transform/stream';
import * as vscode from 'vscode';

// Mock all MCP-related modules
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
            createFileSystemWatcher: jest.fn(() => ({
                onDidCreate: jest.fn(() => mockDisposable),
                onDidDelete: jest.fn(() => mockDisposable),
                onDidChange: jest.fn(() => mockDisposable),
                dispose: jest.fn()
            })),
            fs: {
                stat: jest.fn().mockResolvedValue({ type: 1 }) // FileType.File = 1
            },
            onDidSaveTextDocument: jest.fn(() => mockDisposable)
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
            apiModelId: 'claude-3-5-sonnet-20241022',
            apiKey: 'test-api-key'  // Add API key to mock config
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
        it('should respect provided settings', () => {
            const cline = new Cline(
                mockProvider,
                mockApiConfig,
                'custom instructions',
                false,
                0.95, // 95% threshold
                'test task'
            );

            expect(cline.customInstructions).toBe('custom instructions');
            expect(cline.diffEnabled).toBe(false);
        });

        it('should use default fuzzy match threshold when not provided', () => {
            const cline = new Cline(
                mockProvider,
                mockApiConfig,
                'custom instructions',
                true,
                undefined,
                'test task'
            );

            expect(cline.diffEnabled).toBe(true);
            // The diff strategy should be created with default threshold (1.0)
            expect(cline.diffStrategy).toBeDefined();
        });

        it('should use provided fuzzy match threshold', () => {
            const getDiffStrategySpy = jest.spyOn(require('../diff/DiffStrategy'), 'getDiffStrategy');
            
            const cline = new Cline(
                mockProvider,
                mockApiConfig,
                'custom instructions',
                true,
                0.9, // 90% threshold
                'test task'
            );

            expect(cline.diffEnabled).toBe(true);
            expect(cline.diffStrategy).toBeDefined();
            expect(getDiffStrategySpy).toHaveBeenCalledWith('claude-3-5-sonnet-20241022', 0.9);
            
            getDiffStrategySpy.mockRestore();
        });

        it('should pass default threshold to diff strategy when not provided', () => {
            const getDiffStrategySpy = jest.spyOn(require('../diff/DiffStrategy'), 'getDiffStrategy');
            
            const cline = new Cline(
                mockProvider,
                mockApiConfig,
                'custom instructions',
                true,
                undefined,
                'test task'
            );

            expect(cline.diffEnabled).toBe(true);
            expect(cline.diffStrategy).toBeDefined();
            expect(getDiffStrategySpy).toHaveBeenCalledWith('claude-3-5-sonnet-20241022', 1.0);
            
            getDiffStrategySpy.mockRestore();
        });

        it('should require either task or historyItem', () => {
            expect(() => {
                new Cline(
                    mockProvider,
                    mockApiConfig,
                    undefined, // customInstructions
                    false, // diffEnabled
                    undefined, // fuzzyMatchThreshold
                    undefined // task
                );
            }).toThrow('Either historyItem or task/images must be provided');
        });
    });

    describe('getEnvironmentDetails', () => {
        let originalDate: DateConstructor;
        let mockDate: Date;

        beforeEach(() => {
            originalDate = global.Date;
            const fixedTime = new Date('2024-01-01T12:00:00Z');
            mockDate = new Date(fixedTime);
            mockDate.getTimezoneOffset = jest.fn().mockReturnValue(420); // UTC-7

            class MockDate extends Date {
                constructor() {
                    super();
                    return mockDate;
                }
                static override now() {
                    return mockDate.getTime();
                }
            }
            
            global.Date = MockDate as DateConstructor;

            // Create a proper mock of Intl.DateTimeFormat
            const mockDateTimeFormat = {
                resolvedOptions: () => ({
                    timeZone: 'America/Los_Angeles'
                }),
                format: () => '1/1/2024, 5:00:00 AM'
            };

            const MockDateTimeFormat = function(this: any) {
                return mockDateTimeFormat;
            } as any;

            MockDateTimeFormat.prototype = mockDateTimeFormat;
            MockDateTimeFormat.supportedLocalesOf = jest.fn().mockReturnValue(['en-US']);

            global.Intl.DateTimeFormat = MockDateTimeFormat;
        });

        afterEach(() => {
            global.Date = originalDate;
        });

        it('should include timezone information in environment details', async () => {
            const cline = new Cline(
                mockProvider,
                mockApiConfig,
                undefined,
                false,
                undefined,
                'test task'
            );

            const details = await cline['getEnvironmentDetails'](false);
            
            // Verify timezone information is present and formatted correctly
            expect(details).toContain('America/Los_Angeles');
            expect(details).toMatch(/UTC-7:00/); // Fixed offset for America/Los_Angeles
            expect(details).toContain('# Current Time');
            expect(details).toMatch(/1\/1\/2024.*5:00:00 AM.*\(America\/Los_Angeles, UTC-7:00\)/); // Full time string format
        });
    
        describe('API conversation handling', () => {
            it('should clean conversation history before sending to API', async () => {
                const cline = new Cline(
                    mockProvider,
                    mockApiConfig,
                    undefined,
                    false,
                    undefined,
                    'test task'
                );
    
                // Mock the API's createMessage method to capture the conversation history
                const createMessageSpy = jest.fn();
                const mockStream = {
                    async *[Symbol.asyncIterator]() {
                        yield { type: 'text', text: '' };
                    },
                    async next() {
                        return { done: true, value: undefined };
                    },
                    async return() {
                        return { done: true, value: undefined };
                    },
                    async throw(e: any) {
                        throw e;
                    },
                    async [Symbol.asyncDispose]() {
                        // Cleanup
                    }
                } as AsyncGenerator<ApiStreamChunk>;
                
                jest.spyOn(cline.api, 'createMessage').mockImplementation((...args) => {
                    createMessageSpy(...args);
                    return mockStream;
                });

                // Add a message with extra properties to the conversation history
                const messageWithExtra = {
                    role: 'user' as const,
                    content: [{ type: 'text' as const, text: 'test message' }],
                    ts: Date.now(),
                    extraProp: 'should be removed'
                };
                cline.apiConversationHistory = [messageWithExtra];

                // Trigger an API request
                await cline.recursivelyMakeClineRequests([
                    { type: 'text', text: 'test request' }
                ]);

                // Get all calls to createMessage
                const calls = createMessageSpy.mock.calls;
                
                // Find the call that includes our test message
                const relevantCall = calls.find(call =>
                    call[1]?.some((msg: any) =>
                        msg.content?.[0]?.text === 'test message'
                    )
                );

                // Verify the conversation history was cleaned in the relevant call
                expect(relevantCall?.[1]).toEqual(
                    expect.arrayContaining([
                        {
                            role: 'user',
                            content: [{ type: 'text', text: 'test message' }]
                        }
                    ])
                );

                // Verify extra properties were removed
                const passedMessage = relevantCall?.[1].find((msg: any) =>
                    msg.content?.[0]?.text === 'test message'
                );
                expect(passedMessage).not.toHaveProperty('ts');
                expect(passedMessage).not.toHaveProperty('extraProp');
            });
        });
    });
});
