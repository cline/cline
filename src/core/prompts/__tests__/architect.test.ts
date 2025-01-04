import { ARCHITECT_PROMPT } from '../architect'
import { McpHub } from '../../../services/mcp/McpHub'
import { SearchReplaceDiffStrategy } from '../../../core/diff/strategies/search-replace'
import fs from 'fs/promises'
import os from 'os'
// Import path utils to get access to toPosix string extension
import '../../../utils/path'

// Mock environment-specific values for consistent tests
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: () => '/home/user'
}))

jest.mock('default-shell', () => '/bin/bash')

jest.mock('os-name', () => () => 'Linux')

// Mock fs.readFile to return empty mcpServers config
jest.mock('fs/promises', () => ({
  ...jest.requireActual('fs/promises'),
  readFile: jest.fn().mockImplementation(async (path: string) => {
    if (path.endsWith('mcpSettings.json')) {
      return '{"mcpServers": {}}'
    }
    if (path.endsWith('.clinerules')) {
      return '# Test Rules\n1. First rule\n2. Second rule'
    }
    return ''
  }),
  writeFile: jest.fn().mockResolvedValue(undefined)
}))

// Instead of extending McpHub, create a mock that implements just what we need
const createMockMcpHub = (): McpHub => ({
  getServers: () => [],
  getMcpServersPath: async () => '/mock/mcp/path',
  getMcpSettingsFilePath: async () => '/mock/settings/path',
  dispose: async () => {},
  // Add other required public methods with no-op implementations
  restartConnection: async () => {},
  readResource: async () => ({ contents: [] }),
  callTool: async () => ({ content: [] }),
  toggleServerDisabled: async () => {},
  toggleToolAlwaysAllow: async () => {},
  isConnecting: false,
  connections: []
} as unknown as McpHub)

describe('ARCHITECT_PROMPT', () => {
  let mockMcpHub: McpHub

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(async () => {
    // Clean up any McpHub instances
    if (mockMcpHub) {
      await mockMcpHub.dispose()
    }
  })

  it('should maintain consistent architect prompt', async () => {
    const prompt = await ARCHITECT_PROMPT(
      '/test/path',
      false, // supportsComputerUse
      undefined, // mcpHub
      undefined, // diffStrategy
      undefined // browserViewportSize
    )
    
    expect(prompt).toMatchSnapshot()
  })

  it('should include browser actions when supportsComputerUse is true', async () => {
    const prompt = await ARCHITECT_PROMPT(
      '/test/path',
      true,
      undefined,
      undefined,
      '1280x800'
    )
    
    expect(prompt).toMatchSnapshot()
  })

  it('should include MCP server info when mcpHub is provided', async () => {
    mockMcpHub = createMockMcpHub()

    const prompt = await ARCHITECT_PROMPT(
      '/test/path',
      false,
      mockMcpHub
    )
    
    expect(prompt).toMatchSnapshot()
  })

  it('should explicitly handle undefined mcpHub', async () => {
    const prompt = await ARCHITECT_PROMPT(
      '/test/path',
      false,
      undefined, // explicitly undefined mcpHub
      undefined,
      undefined
    )
    
    expect(prompt).toMatchSnapshot()
  })

  it('should handle different browser viewport sizes', async () => {
    const prompt = await ARCHITECT_PROMPT(
      '/test/path',
      true,
      undefined,
      undefined,
      '900x600' // different viewport size
    )
    
    expect(prompt).toMatchSnapshot()
  })

  it('should include diff strategy tool description', async () => {
    const prompt = await ARCHITECT_PROMPT(
      '/test/path',
      false,
      undefined,
      new SearchReplaceDiffStrategy(), // Use actual diff strategy from the codebase
      undefined
    )
    
    expect(prompt).toMatchSnapshot()
  })

  afterAll(() => {
    jest.restoreAllMocks()
  })
})