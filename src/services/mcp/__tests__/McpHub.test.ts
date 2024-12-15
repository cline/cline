import type { McpHub as McpHubType } from '../McpHub'
import type { ClineProvider } from '../../../core/webview/ClineProvider'
import type { ExtensionContext, Uri } from 'vscode'
import type { McpConnection } from '../McpHub'

const vscode = require('vscode')
const fs = require('fs/promises')
const { McpHub } = require('../McpHub')

jest.mock('vscode')
jest.mock('fs/promises')
jest.mock('../../../core/webview/ClineProvider')

describe('McpHub', () => {
  let mcpHub: McpHubType
  let mockProvider: Partial<ClineProvider>
  const mockSettingsPath = '/mock/settings/path/cline_mcp_settings.json'

  beforeEach(() => {
    jest.clearAllMocks()

    const mockUri: Uri = {
      scheme: 'file',
      authority: '',
      path: '/test/path',
      query: '',
      fragment: '',
      fsPath: '/test/path',
      with: jest.fn(),
      toJSON: jest.fn()
    }

    mockProvider = {
      ensureSettingsDirectoryExists: jest.fn().mockResolvedValue('/mock/settings/path'),
      ensureMcpServersDirectoryExists: jest.fn().mockResolvedValue('/mock/settings/path'),
      postMessageToWebview: jest.fn(),
      context: {
        subscriptions: [],
        workspaceState: {} as any,
        globalState: {} as any,
        secrets: {} as any,
        extensionUri: mockUri,
        extensionPath: '/test/path',
        storagePath: '/test/storage',
        globalStoragePath: '/test/global-storage',
        environmentVariableCollection: {} as any,
        extension: {
          id: 'test-extension',
          extensionUri: mockUri,
          extensionPath: '/test/path',
          extensionKind: 1,
          isActive: true,
          packageJSON: {
            version: '1.0.0'
          },
          activate: jest.fn(),
          exports: undefined
        } as any,
        asAbsolutePath: (path: string) => path,
        storageUri: mockUri,
        globalStorageUri: mockUri,
        logUri: mockUri,
        extensionMode: 1,
        logPath: '/test/path',
        languageModelAccessInformation: {} as any
      } as ExtensionContext
    }

    // Mock fs.readFile for initial settings
    ;(fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify({
      mcpServers: {
        'test-server': {
          command: 'node',
          args: ['test.js'],
          alwaysAllow: ['allowed-tool']
        }
      }
    }))

    mcpHub = new McpHub(mockProvider as ClineProvider)
  })

  describe('toggleToolAlwaysAllow', () => {
    it('should add tool to always allow list when enabling', async () => {
      const mockConfig = {
        mcpServers: {
          'test-server': {
            command: 'node',
            args: ['test.js'],
            alwaysAllow: []
          }
        }
      }

      // Mock reading initial config
      ;(fs.readFile as jest.Mock).mockResolvedValueOnce(JSON.stringify(mockConfig))

      await mcpHub.toggleToolAlwaysAllow('test-server', 'new-tool', true)

      // Verify the config was updated correctly
      const writeCall = (fs.writeFile as jest.Mock).mock.calls[0]
      const writtenConfig = JSON.parse(writeCall[1])
      expect(writtenConfig.mcpServers['test-server'].alwaysAllow).toContain('new-tool')
    })

    it('should remove tool from always allow list when disabling', async () => {
      const mockConfig = {
        mcpServers: {
          'test-server': {
            command: 'node',
            args: ['test.js'],
            alwaysAllow: ['existing-tool']
          }
        }
      }

      // Mock reading initial config
      ;(fs.readFile as jest.Mock).mockResolvedValueOnce(JSON.stringify(mockConfig))

      await mcpHub.toggleToolAlwaysAllow('test-server', 'existing-tool', false)

      // Verify the config was updated correctly
      const writeCall = (fs.writeFile as jest.Mock).mock.calls[0]
      const writtenConfig = JSON.parse(writeCall[1])
      expect(writtenConfig.mcpServers['test-server'].alwaysAllow).not.toContain('existing-tool')
    })

    it('should initialize alwaysAllow if it does not exist', async () => {
      const mockConfig = {
        mcpServers: {
          'test-server': {
            command: 'node',
            args: ['test.js']
          }
        }
      }

      // Mock reading initial config
      ;(fs.readFile as jest.Mock).mockResolvedValueOnce(JSON.stringify(mockConfig))

      await mcpHub.toggleToolAlwaysAllow('test-server', 'new-tool', true)

      // Verify the config was updated with initialized alwaysAllow
      const writeCall = (fs.writeFile as jest.Mock).mock.calls[0]
      const writtenConfig = JSON.parse(writeCall[1])
      expect(writtenConfig.mcpServers['test-server'].alwaysAllow).toBeDefined()
      expect(writtenConfig.mcpServers['test-server'].alwaysAllow).toContain('new-tool')
    })
  })

  describe('server disabled state', () => {
    it('should toggle server disabled state', async () => {
      const mockConfig = {
        mcpServers: {
          'test-server': {
            command: 'node',
            args: ['test.js'],
            disabled: false
          }
        }
      }

      // Mock reading initial config
      ;(fs.readFile as jest.Mock).mockResolvedValueOnce(JSON.stringify(mockConfig))

      await mcpHub.toggleServerDisabled('test-server', true)

      // Verify the config was updated correctly
      const writeCall = (fs.writeFile as jest.Mock).mock.calls[0]
      const writtenConfig = JSON.parse(writeCall[1])
      expect(writtenConfig.mcpServers['test-server'].disabled).toBe(true)
    })

    it('should filter out disabled servers from getServers', () => {
      const mockConnections: McpConnection[] = [
        {
          server: {
            name: 'enabled-server',
            config: '{}',
            status: 'connected',
            disabled: false
          },
          client: {} as any,
          transport: {} as any
        },
        {
          server: {
            name: 'disabled-server',
            config: '{}',
            status: 'connected',
            disabled: true
          },
          client: {} as any,
          transport: {} as any
        }
      ]

      mcpHub.connections = mockConnections
      const servers = mcpHub.getServers()

      expect(servers.length).toBe(1)
      expect(servers[0].name).toBe('enabled-server')
    })

    it('should prevent calling tools on disabled servers', async () => {
      const mockConnection: McpConnection = {
        server: {
          name: 'disabled-server',
          config: '{}',
          status: 'connected',
          disabled: true
        },
        client: {
          request: jest.fn().mockResolvedValue({ result: 'success' })
        } as any,
        transport: {} as any
      }

      mcpHub.connections = [mockConnection]

      await expect(mcpHub.callTool('disabled-server', 'some-tool', {}))
        .rejects
        .toThrow('Server "disabled-server" is disabled and cannot be used')
    })

    it('should prevent reading resources from disabled servers', async () => {
      const mockConnection: McpConnection = {
        server: {
          name: 'disabled-server',
          config: '{}',
          status: 'connected',
          disabled: true
        },
        client: {
          request: jest.fn()
        } as any,
        transport: {} as any
      }

      mcpHub.connections = [mockConnection]

      await expect(mcpHub.readResource('disabled-server', 'some/uri'))
        .rejects
        .toThrow('Server "disabled-server" is disabled')
    })
  })

  describe('callTool', () => {
    it('should execute tool successfully', async () => {
      // Mock the connection with a minimal client implementation
      const mockConnection: McpConnection = {
        server: {
          name: 'test-server',
          config: JSON.stringify({}),
          status: 'connected' as const
        },
        client: {
          request: jest.fn().mockResolvedValue({ result: 'success' })
        } as any,
        transport: {
          start: jest.fn(),
          close: jest.fn(),
          stderr: { on: jest.fn() }
        } as any
      }

      mcpHub.connections = [mockConnection]

      await mcpHub.callTool('test-server', 'some-tool', {})

      // Verify the request was made with correct parameters
      expect(mockConnection.client.request).toHaveBeenCalledWith(
        {
          method: 'tools/call',
          params: {
            name: 'some-tool',
            arguments: {}
          }
        },
        expect.any(Object)
      )
    })

    it('should throw error if server not found', async () => {
      await expect(mcpHub.callTool('non-existent-server', 'some-tool', {}))
        .rejects
        .toThrow('No connection found for server: non-existent-server')
    })
  })
})