import { SYSTEM_PROMPT, addCustomInstructions } from '../system'
import { McpHub } from '../../../services/mcp/McpHub'
import { McpServer } from '../../../shared/mcp'
import { ClineProvider } from '../../../core/webview/ClineProvider'
import { SearchReplaceDiffStrategy } from '../../../core/diff/strategies/search-replace'
import fs from 'fs/promises'
import os from 'os'
import { defaultModeSlug, modes } from '../../../shared/modes'
// Import path utils to get access to toPosix string extension
import '../../../utils/path'

// Mock environment-specific values for consistent tests
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: () => '/home/user'
}))

jest.mock('default-shell', () => '/bin/bash')

jest.mock('os-name', () => () => 'Linux')

// Mock fs.readFile to return empty mcpServers config and mock rules files
jest.mock('fs/promises', () => ({
  ...jest.requireActual('fs/promises'),
  readFile: jest.fn().mockImplementation(async (path: string) => {
    if (path.endsWith('mcpSettings.json')) {
      return '{"mcpServers": {}}'
    }
    if (path.endsWith('.clinerules-code')) {
      return '# Code Mode Rules\n1. Code specific rule'
    }
    if (path.endsWith('.clinerules-ask')) {
      return '# Ask Mode Rules\n1. Ask specific rule'
    }
    if (path.endsWith('.clinerules-architect')) {
      return '# Architect Mode Rules\n1. Architect specific rule'
    }
    if (path.endsWith('.clinerules')) {
      return '# Test Rules\n1. First rule\n2. Second rule'
    }
    return ''
  }),
  writeFile: jest.fn().mockResolvedValue(undefined)
}))

// Create a minimal mock of ClineProvider
const mockProvider = {
  ensureMcpServersDirectoryExists: async () => '/mock/mcp/path',
  ensureSettingsDirectoryExists: async () => '/mock/settings/path',
  postMessageToWebview: async () => {},
  context: {
    extension: {
      packageJSON: {
        version: '1.0.0'
      }
    }
  }
} as unknown as ClineProvider

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

describe('SYSTEM_PROMPT', () => {
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

  it('should maintain consistent system prompt', async () => {
    const prompt = await SYSTEM_PROMPT(
      '/test/path',
      false, // supportsComputerUse
      undefined, // mcpHub
      undefined, // diffStrategy
      undefined // browserViewportSize
    )
    
    expect(prompt).toMatchSnapshot()
  })

  it('should include browser actions when supportsComputerUse is true', async () => {
    const prompt = await SYSTEM_PROMPT(
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

    const prompt = await SYSTEM_PROMPT(
      '/test/path',
      false,
      mockMcpHub
    )
    
    expect(prompt).toMatchSnapshot()
  })

  it('should explicitly handle undefined mcpHub', async () => {
    const prompt = await SYSTEM_PROMPT(
      '/test/path',
      false,
      undefined, // explicitly undefined mcpHub
      undefined,
      undefined
    )
    
    expect(prompt).toMatchSnapshot()
  })

  it('should handle different browser viewport sizes', async () => {
    const prompt = await SYSTEM_PROMPT(
      '/test/path',
      true,
      undefined,
      undefined,
      '900x600' // different viewport size
    )
    
    expect(prompt).toMatchSnapshot()
  })

  it('should include diff strategy tool description', async () => {
    const prompt = await SYSTEM_PROMPT(
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

describe('addCustomInstructions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should generate correct prompt for architect mode', async () => {
    const prompt = await SYSTEM_PROMPT(
      '/test/path',
      false,
      undefined,
      undefined,
      undefined,
      'architect'
    )
    
    expect(prompt).toMatchSnapshot()
  })

  it('should generate correct prompt for ask mode', async () => {
    const prompt = await SYSTEM_PROMPT(
      '/test/path',
      false,
      undefined,
      undefined,
      undefined,
      'ask'
    )
    
    expect(prompt).toMatchSnapshot()
  })

  it('should prioritize mode-specific rules for code mode', async () => {
    const instructions = await addCustomInstructions(
      {},
      '/test/path',
      defaultModeSlug
    )
    expect(instructions).toMatchSnapshot()
  })

  it('should prioritize mode-specific rules for ask mode', async () => {
    const instructions = await addCustomInstructions(
      {},
      '/test/path',
      modes[2].slug
    )
    expect(instructions).toMatchSnapshot()
  })

  it('should prioritize mode-specific rules for architect mode', async () => {
    const instructions = await addCustomInstructions(
      {},
      '/test/path',
      modes[1].slug
    )
    
    expect(instructions).toMatchSnapshot()
  })

  it('should prioritize mode-specific rules for test engineer mode', async () => {
    // Mock readFile to include test engineer rules
    const mockReadFile = jest.fn().mockImplementation(async (path: string) => {
      if (path.endsWith('.clinerules-test')) {
        return '# Test Engineer Rules\n1. Always write tests first\n2. Get approval before modifying non-test code'
      }
      if (path.endsWith('.clinerules')) {
        return '# Test Rules\n1. First rule\n2. Second rule'
      }
      return ''
    })
    jest.spyOn(fs, 'readFile').mockImplementation(mockReadFile)

    const instructions = await addCustomInstructions(
      {},
      '/test/path',
      'test'
    )
    expect(instructions).toMatchSnapshot()
  })

  it('should prioritize mode-specific rules for code reviewer mode', async () => {
    // Mock readFile to include code reviewer rules
    const mockReadFile = jest.fn().mockImplementation(async (path: string) => {
      if (path.endsWith('.clinerules-review')) {
        return '# Code Reviewer Rules\n1. Provide specific examples in feedback\n2. Focus on maintainability and best practices'
      }
      if (path.endsWith('.clinerules')) {
        return '# Test Rules\n1. First rule\n2. Second rule'
      }
      return ''
    })
    jest.spyOn(fs, 'readFile').mockImplementation(mockReadFile)

    const instructions = await addCustomInstructions(
      {},
      '/test/path',
      'review'
    )
    expect(instructions).toMatchSnapshot()
  })

  it('should generate correct prompt for test engineer mode', async () => {
    const prompt = await SYSTEM_PROMPT(
      '/test/path',
      false,
      undefined,
      undefined,
      undefined,
      'test'
    )
    
    // Verify test engineer role requirements
    expect(prompt).toContain('must ask the user to confirm before making ANY changes to non-test code')
    expect(prompt).toContain('ask the user to confirm your test plan')
    expect(prompt).toMatchSnapshot()
  })

  it('should generate correct prompt for code reviewer mode', async () => {
    const prompt = await SYSTEM_PROMPT(
      '/test/path',
      false,
      undefined,
      undefined,
      undefined,
      'review'
    )
    
    // Verify code reviewer role constraints
    expect(prompt).toContain('providing detailed, actionable feedback')
    expect(prompt).toContain('maintain a read-only approach')
    expect(prompt).toMatchSnapshot()
  })

  it('should fall back to generic rules when mode-specific rules not found', async () => {
    // Mock readFile to return ENOENT for mode-specific file
    const mockReadFile = jest.fn().mockImplementation(async (path: string) => {
      if (path.endsWith('.clinerules-code') || 
          path.endsWith('.clinerules-test') || 
          path.endsWith('.clinerules-review')) {
        const error = new Error('ENOENT') as NodeJS.ErrnoException
        error.code = 'ENOENT'
        throw error
      }
      if (path.endsWith('.clinerules')) {
        return '# Test Rules\n1. First rule\n2. Second rule'
      }
      return ''
    })
    jest.spyOn(fs, 'readFile').mockImplementation(mockReadFile)

    const instructions = await addCustomInstructions(
      {},
      '/test/path',
      defaultModeSlug
    )
    
    expect(instructions).toMatchSnapshot()
  })

  it('should include preferred language when provided', async () => {
    const instructions = await addCustomInstructions(
      { preferredLanguage: 'Spanish' },
      '/test/path',
      defaultModeSlug
    )
    
    expect(instructions).toMatchSnapshot()
  })

  it('should include custom instructions when provided', async () => {
    const instructions = await addCustomInstructions(
      { customInstructions: 'Custom test instructions' },
      '/test/path'
    )
    
    expect(instructions).toMatchSnapshot()
  })

  it('should combine all custom instructions', async () => {
    const instructions = await addCustomInstructions(
      {
        customInstructions: 'Custom test instructions',
        preferredLanguage: 'French'
      },
      '/test/path',
      defaultModeSlug
    )
    expect(instructions).toMatchSnapshot()
  })

  it('should handle undefined mode-specific instructions', async () => {
    const instructions = await addCustomInstructions(
      {},
      '/test/path'
    )
    
    expect(instructions).toMatchSnapshot()
  })

  it('should trim mode-specific instructions', async () => {
    const instructions = await addCustomInstructions(
      { customInstructions: '  Custom mode instructions  ' },
      '/test/path'
    )
    
    expect(instructions).toMatchSnapshot()
  })

  it('should handle empty mode-specific instructions', async () => {
    const instructions = await addCustomInstructions(
      { customInstructions: '' },
      '/test/path'
    )
    
    expect(instructions).toMatchSnapshot()
  })

  it('should combine global and mode-specific instructions', async () => {
    const instructions = await addCustomInstructions(
      {
        customInstructions: 'Global instructions',
        customPrompts: {
          code: { customInstructions: 'Mode-specific instructions' }
        }
      },
      '/test/path',
      defaultModeSlug
    )
    
    expect(instructions).toMatchSnapshot()
  })

  it('should prioritize mode-specific instructions after global ones', async () => {
    const instructions = await addCustomInstructions(
      {
        customInstructions: 'First instruction',
        customPrompts: {
          code: { customInstructions: 'Second instruction' }
        }
      },
      '/test/path',
      defaultModeSlug
    )
    
    const instructionParts = instructions.split('\n\n')
    const globalIndex = instructionParts.findIndex(part => part.includes('First instruction'))
    const modeSpecificIndex = instructionParts.findIndex(part => part.includes('Second instruction'))
    
    expect(globalIndex).toBeLessThan(modeSpecificIndex)
    expect(instructions).toMatchSnapshot()
  })

  afterAll(() => {
    jest.restoreAllMocks()
  })
})
