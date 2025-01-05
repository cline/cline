import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as vscode from 'vscode'
import { TerminalManager } from './TerminalManager'
import { TerminalInfo, TerminalRegistry } from './TerminalRegistry'
import { arePathsEqual } from '../../utils/path'

// Mock the entire TerminalRegistry module
vi.mock('./TerminalRegistry', () => {
  const terminals: any[] = []
  let nextTerminalId = 1

  return {
    TerminalRegistry: {
      terminals,
      getNextTerminalId: vi.fn(() => nextTerminalId++),
      getAllTerminals: vi.fn(() => terminals),
      createTerminal: vi.fn((cwd?: string | vscode.Uri) => {
        const terminal: TerminalInfo = {
          terminal: { processId: 0, creationOptions: {} } as vscode.Terminal,
          busy: false,
          lastCommand: '',
          id: TerminalRegistry.getNextTerminalId(),
        }
        terminals.push(terminal)
        return terminal
      }),
      getTerminal: vi.fn((id: number) => {
        return terminals.find(t => t.id === id)
      }),
      updateTerminal: vi.fn((id: number, updates: any) => {
        const terminal = terminals.find(t => t.id === id)
        if (terminal) {
          Object.assign(terminal, updates)
        }
      }),
      removeTerminal: vi.fn((id: number) => {
        const index = terminals.findIndex(t => t.id === id)
        if (index !== -1) {
          terminals.splice(index, 1)
        }
      }),
    }
  }
})

describe('TerminalManager Methods', () => {
  let terminalManager: TerminalManager

  beforeEach(() => {
    // Reset mocks before each test
    terminalManager = new TerminalManager()
    
    // Mock TerminalRegistry methods with a more flexible createTerminal
    const mockTerminals: TerminalInfo[] = []
    let nextId = 1  // Reset ID counter for each test
    
    // Mock the private terminals array
    Object.defineProperty(TerminalRegistry, 'terminals', {
      get: () => mockTerminals,
      set: (value) => {
        mockTerminals.length = 0
        mockTerminals.push(...value)
      },
      configurable: true
    })
    
    // Reset and mock nextTerminalId
    Object.defineProperty(TerminalRegistry, 'nextTerminalId', {
      get: () => nextId,
      set: (value) => {
        nextId = value
      },
      configurable: true
    })
    
    vi.spyOn(TerminalRegistry, 'getAllTerminals').mockImplementation(() => mockTerminals)
    
    vi.spyOn(TerminalRegistry, 'createTerminal').mockImplementation((cwd?: string | vscode.Uri) => {
      // Create a comprehensive mock terminal
      const terminal = {
        name: "Cline",
        sendText: vi.fn(),
        show: vi.fn(),
        hide: vi.fn(),
        dispose: vi.fn(),
        shellIntegration: {
          cwd: typeof cwd === 'string' ? vscode.Uri.file(cwd) : cwd
        }
      } as vscode.Terminal
      
      // Create a mutable terminal info object
      const terminalInfo: TerminalInfo = {
        terminal,
        busy: false,
        lastCommand: "",
        id: nextId++
      }

      // Special handling for specific mock CWDs
      if (typeof cwd === 'string') {
        if (cwd === '/test/path') {
          terminalInfo.busy = true
        }
      }

      mockTerminals.push(terminalInfo)
      return terminalInfo
    })
  })

  afterEach(() => {
    terminalManager.disposeAll()
    vi.restoreAllMocks()
  })

  describe('getOrCreateTerminal', () => {
    it('should return an existing terminal with matching CWD', async () => {
      const mockCwd = '/test/path'
      const mockTerminal = TerminalRegistry.createTerminal(mockCwd)
      
      // Create a more complete mock of the terminal
      vi.spyOn(mockTerminal.terminal, 'shellIntegration' as any, 'get').mockReturnValue({
        cwd: vscode.Uri.file(mockCwd)
      })

      const result = await terminalManager.getOrCreateTerminal(mockCwd)

      expect(result.id).toBe(mockTerminal.id)
      expect(result.busy).toBe(mockTerminal.busy)
      expect(result.lastCommand).toBe(mockTerminal.lastCommand)
      expect(terminalManager['terminalIds'].has(mockTerminal.id)).toBe(true)
    })

    it('should create a new terminal when no matching terminal exists', async () => {
      const mockCwd = '/new/test/path'

      const result = await terminalManager.getOrCreateTerminal(mockCwd)

      expect(result).toBeDefined()
      expect(result.id).toBeDefined()
      expect(terminalManager['terminalIds'].has(result.id)).toBe(true)
      expect(TerminalRegistry.createTerminal).toHaveBeenCalledWith(mockCwd)
    })

    it('should skip busy terminals', async () => {
      const mockCwd = '/test/path'
      const busyTerminal = TerminalRegistry.createTerminal(mockCwd)
      
      // Create a more complete mock of the terminal
      vi.spyOn(busyTerminal.terminal, 'shellIntegration' as any, 'get').mockReturnValue({
        cwd: vscode.Uri.file(mockCwd)
      })

      const availableTerminal = TerminalRegistry.createTerminal('/other/path')
      
      // Create a more complete mock of the terminal
      vi.spyOn(availableTerminal.terminal, 'shellIntegration' as any, 'get').mockReturnValue({
        cwd: vscode.Uri.file('/other/path')
      })

      const result = await terminalManager.getOrCreateTerminal(mockCwd)

      expect(result.id).not.toBe(busyTerminal.id)
      expect(result.busy).toBe(false)
      expect(terminalManager['terminalIds'].has(result.id)).toBe(true)
    })
  })

  describe('getTerminals', () => {
    it('should return terminals filtered by busy status', () => {
      const createTerminalSpy = vi.spyOn(TerminalRegistry, 'createTerminal').mockImplementation((cwd?: string | vscode.Uri | undefined) => {
        console.log(`Creating terminal with cwd: ${cwd}`);
        const terminal = vscode.window.createTerminal({
          cwd,
          name: "Cline",
          iconPath: new vscode.ThemeIcon("robot"),
        });
        const newInfo: TerminalInfo = {
          terminal: terminal,
          busy: false,
          lastCommand: "",
          id: TerminalRegistry.getNextTerminalId(),
        };
        TerminalRegistry.terminals.push(newInfo);
        console.log(`New terminal created: ${newInfo}`);
        return newInfo;
      });

      const busyTerminal = TerminalRegistry.createTerminal()
      busyTerminal.busy = true
      busyTerminal.lastCommand = 'busy command'

      const idleTerminal = TerminalRegistry.createTerminal()
      idleTerminal.busy = false
      idleTerminal.lastCommand = 'idle command'

      // Add terminal IDs to the manager
      terminalManager['terminalIds'].add(busyTerminal.id)
      terminalManager['terminalIds'].add(idleTerminal.id)

      // Get busy terminals
      const busyTerminals = terminalManager.getTerminals(true)
      expect(busyTerminals).toEqual([
        { id: busyTerminal.id, lastCommand: 'busy command' }
      ])

      // Get idle terminals
      const idleTerminals = terminalManager.getTerminals(false)
      expect(idleTerminals).toEqual([
        { id: idleTerminal.id, lastCommand: 'idle command' }
      ])
    })

    it('should return empty array when no terminals match', () => {
      // No terminals added
      const busyTerminals = terminalManager.getTerminals(true)
      const idleTerminals = terminalManager.getTerminals(false)

      expect(busyTerminals).toEqual([])
      expect(idleTerminals).toEqual([])
    })
  })

  describe('getUnretrievedOutput', () => {
    it('should return unretrieved output for an existing process', () => {
      const mockTerminalId = 1
      const mockOutput = 'test output'
      const mockProcess = {
        getUnretrievedOutput: vi.fn().mockReturnValue(mockOutput)
      }

      // Add the terminal ID and process
      terminalManager['terminalIds'].add(mockTerminalId)
      terminalManager['processes'].set(mockTerminalId, mockProcess as any)

      const output = terminalManager.getUnretrievedOutput(mockTerminalId)

      expect(output).toBe(mockOutput)
      expect(mockProcess.getUnretrievedOutput).toHaveBeenCalled()
    })

    it('should return empty string for non-existing terminal', () => {
      const mockTerminalId = 1
      const output = terminalManager.getUnretrievedOutput(mockTerminalId)

      expect(output).toBe('')
    })

    it('should return empty string for terminal without a process', () => {
      const mockTerminalId = 1
      
      // Add the terminal ID without a process
      terminalManager['terminalIds'].add(mockTerminalId)

      const output = terminalManager.getUnretrievedOutput(mockTerminalId)

      expect(output).toBe('')
    })
  })

  describe('isProcessHot', () => {
    it('should return true for an existing hot process', () => {
      const mockTerminalId = 1
      const mockProcess = {
        isHot: true
      }

      // Add the terminal ID and process
      terminalManager['terminalIds'].add(mockTerminalId)
      terminalManager['processes'].set(mockTerminalId, mockProcess as any)

      const isHot = terminalManager.isProcessHot(mockTerminalId)

      expect(isHot).toBe(true)
    })

    it('should return false for a non-existing process', () => {
      const mockTerminalId = 1
      const isHot = terminalManager.isProcessHot(mockTerminalId)

      expect(isHot).toBe(false)
    })
  })

  describe('disposeAll', () => {
    it('should clear terminal IDs and processes', () => {
      const mockDisposable1 = { dispose: vi.fn() }
      const mockDisposable2 = { dispose: vi.fn() }

      // Add some mock data
      terminalManager['terminalIds'].add(1)
      terminalManager['terminalIds'].add(2)
      terminalManager['processes'].set(1, {} as any)
      terminalManager['processes'].set(2, {} as any)
      terminalManager['disposables'] = [mockDisposable1, mockDisposable2]

      terminalManager.disposeAll()

      // Check that everything is cleared
      expect(terminalManager['terminalIds'].size).toBe(0)
      expect(terminalManager['processes'].size).toBe(0)
      expect(terminalManager['disposables'].length).toBe(0)

      // Check that disposables were called
      expect(mockDisposable1.dispose).toHaveBeenCalled()
      expect(mockDisposable2.dispose).toHaveBeenCalled()
    })
  })
})
