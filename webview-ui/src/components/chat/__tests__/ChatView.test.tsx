import React from 'react'
import { render, waitFor } from '@testing-library/react'
import ChatView from '../ChatView'
import { ExtensionStateContextProvider } from '../../../context/ExtensionStateContext'
import { vscode } from '../../../utils/vscode'

// Define minimal types needed for testing
interface ClineMessage {
  type: 'say' | 'ask';
  say?: string;
  ask?: string;
  ts: number;
  text?: string;
  partial?: boolean;
}

interface ExtensionState {
  version: string;
  clineMessages: ClineMessage[];
  taskHistory: any[];
  shouldShowAnnouncement: boolean;
  allowedCommands: string[];
  alwaysAllowExecute: boolean;
  [key: string]: any;
}

// Mock vscode API
jest.mock('../../../utils/vscode', () => ({
  vscode: {
    postMessage: jest.fn(),
  },
}))

// Mock components that use ESM dependencies
jest.mock('../BrowserSessionRow', () => ({
  __esModule: true,
  default: function MockBrowserSessionRow({ messages }: { messages: ClineMessage[] }) {
    return <div data-testid="browser-session">{JSON.stringify(messages)}</div>
  }
}))

jest.mock('../ChatRow', () => ({
  __esModule: true,
  default: function MockChatRow({ message }: { message: ClineMessage }) {
    return <div data-testid="chat-row">{JSON.stringify(message)}</div>
  }
}))

interface ChatTextAreaProps {
  onSend: (value: string) => void;
  inputValue?: string;
  textAreaDisabled?: boolean;
  placeholderText?: string;
  selectedImages?: string[];
  shouldDisableImages?: boolean;
}

jest.mock('../ChatTextArea', () => {
  const mockReact = require('react')
  return {
    __esModule: true,
    default: mockReact.forwardRef(function MockChatTextArea(props: ChatTextAreaProps, ref: React.ForwardedRef<HTMLInputElement>) {
      return (
        <div data-testid="chat-textarea">
          <input ref={ref} type="text" onChange={(e) => props.onSend(e.target.value)} />
        </div>
      )
    })
  }
})

jest.mock('../TaskHeader', () => ({
  __esModule: true,
  default: function MockTaskHeader({ task }: { task: ClineMessage }) {
    return <div data-testid="task-header">{JSON.stringify(task)}</div>
  }
}))

// Mock VSCode components
jest.mock('@vscode/webview-ui-toolkit/react', () => ({
  VSCodeButton: function MockVSCodeButton({ 
    children,
    onClick,
    appearance 
  }: { 
    children: React.ReactNode;
    onClick?: () => void;
    appearance?: string;
  }) {
    return <button onClick={onClick} data-appearance={appearance}>{children}</button>
  },
  VSCodeTextField: function MockVSCodeTextField({ 
    value,
    onInput,
    placeholder 
  }: {
    value?: string;
    onInput?: (e: { target: { value: string } }) => void;
    placeholder?: string;
  }) {
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => onInput?.({ target: { value: e.target.value } })}
        placeholder={placeholder}
      />
    )
  },
  VSCodeLink: function MockVSCodeLink({ 
    children,
    href 
  }: {
    children: React.ReactNode;
    href?: string;
  }) {
    return <a href={href}>{children}</a>
  }
}))

// Mock window.postMessage to trigger state hydration
const mockPostMessage = (state: Partial<ExtensionState>) => {
  window.postMessage({
    type: 'state',
    state: {
      version: '1.0.0',
      clineMessages: [],
      taskHistory: [],
      shouldShowAnnouncement: false,
      allowedCommands: [],
      alwaysAllowExecute: false,
      ...state
    }
  }, '*')
}

describe('ChatView - Auto Approval Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('auto-approves browser actions when alwaysAllowBrowser is enabled', async () => {
    render(
      <ExtensionStateContextProvider>
        <ChatView 
          isHidden={false}
          showAnnouncement={false}
          hideAnnouncement={() => {}}
          showHistoryView={() => {}}
        />
      </ExtensionStateContextProvider>
    )

    // First hydrate state with initial task
    mockPostMessage({
      alwaysAllowBrowser: true,
      clineMessages: [
        {
          type: 'say',
          say: 'task',
          ts: Date.now() - 2000,
          text: 'Initial task'
        }
      ]
    })

    // Then send the browser action ask message
    mockPostMessage({
      alwaysAllowBrowser: true,
      clineMessages: [
        {
          type: 'say',
          say: 'task',
          ts: Date.now() - 2000,
          text: 'Initial task'
        },
        {
          type: 'ask',
          ask: 'browser_action_launch',
          ts: Date.now(),
          text: JSON.stringify({ action: 'launch', url: 'http://example.com' }),
          partial: false
        }
      ]
    })

    // Wait for the auto-approval message
    await waitFor(() => {
      expect(vscode.postMessage).toHaveBeenCalledWith({
        type: 'askResponse',
        askResponse: 'yesButtonClicked'
      })
    })
  })

  it('auto-approves read-only tools when alwaysAllowReadOnly is enabled', async () => {
    render(
      <ExtensionStateContextProvider>
        <ChatView 
          isHidden={false}
          showAnnouncement={false}
          hideAnnouncement={() => {}}
          showHistoryView={() => {}}
        />
      </ExtensionStateContextProvider>
    )

    // First hydrate state with initial task
    mockPostMessage({
      alwaysAllowReadOnly: true,
      clineMessages: [
        {
          type: 'say',
          say: 'task',
          ts: Date.now() - 2000,
          text: 'Initial task'
        }
      ]
    })

    // Then send the read-only tool ask message
    mockPostMessage({
      alwaysAllowReadOnly: true,
      clineMessages: [
        {
          type: 'say',
          say: 'task',
          ts: Date.now() - 2000,
          text: 'Initial task'
        },
        {
          type: 'ask',
          ask: 'tool',
          ts: Date.now(),
          text: JSON.stringify({ tool: 'readFile', path: 'test.txt' }),
          partial: false
        }
      ]
    })

    // Wait for the auto-approval message
    await waitFor(() => {
      expect(vscode.postMessage).toHaveBeenCalledWith({
        type: 'askResponse',
        askResponse: 'yesButtonClicked'
      })
    })
  })

  describe('Write Tool Auto-Approval Tests', () => {
    it('auto-approves write tools when alwaysAllowWrite is enabled and message is a tool request', async () => {
      render(
        <ExtensionStateContextProvider>
          <ChatView
            isHidden={false}
            showAnnouncement={false}
            hideAnnouncement={() => {}}
            showHistoryView={() => {}}
          />
        </ExtensionStateContextProvider>
      )

      // First hydrate state with initial task
      mockPostMessage({
        alwaysAllowWrite: true,
        clineMessages: [
          {
            type: 'say',
            say: 'task',
            ts: Date.now() - 2000,
            text: 'Initial task'
          }
        ]
      })

      // Then send the write tool ask message
      mockPostMessage({
        alwaysAllowWrite: true,
        clineMessages: [
          {
            type: 'say',
            say: 'task',
            ts: Date.now() - 2000,
            text: 'Initial task'
          },
          {
            type: 'ask',
            ask: 'tool',
            ts: Date.now(),
            text: JSON.stringify({ tool: 'editedExistingFile', path: 'test.txt' }),
            partial: false
          }
        ]
      })

      // Wait for the auto-approval message
      await waitFor(() => {
        expect(vscode.postMessage).toHaveBeenCalledWith({
          type: 'askResponse',
          askResponse: 'yesButtonClicked'
        })
      })
    })

    it('does not auto-approve write operations when alwaysAllowWrite is enabled but message is not a tool request', () => {
      render(
        <ExtensionStateContextProvider>
          <ChatView
            isHidden={false}
            showAnnouncement={false}
            hideAnnouncement={() => {}}
            showHistoryView={() => {}}
          />
        </ExtensionStateContextProvider>
      )

      // First hydrate state with initial task
      mockPostMessage({
        alwaysAllowWrite: true,
        clineMessages: [
          {
            type: 'say',
            say: 'task',
            ts: Date.now() - 2000,
            text: 'Initial task'
          }
        ]
      })

      // Then send a non-tool write operation message
      mockPostMessage({
        alwaysAllowWrite: true,
        clineMessages: [
          {
            type: 'say',
            say: 'task',
            ts: Date.now() - 2000,
            text: 'Initial task'
          },
          {
            type: 'ask',
            ask: 'write_operation',
            ts: Date.now(),
            text: JSON.stringify({ path: 'test.txt', content: 'test content' }),
            partial: false
          }
        ]
      })

      // Verify no auto-approval message was sent
      expect(vscode.postMessage).not.toHaveBeenCalledWith({
        type: 'askResponse',
        askResponse: 'yesButtonClicked'
      })
    })
  })

  it('auto-approves allowed commands when alwaysAllowExecute is enabled', async () => {
    render(
      <ExtensionStateContextProvider>
        <ChatView 
          isHidden={false}
          showAnnouncement={false}
          hideAnnouncement={() => {}}
          showHistoryView={() => {}}
        />
      </ExtensionStateContextProvider>
    )

    // First hydrate state with initial task
    mockPostMessage({
      alwaysAllowExecute: true,
      allowedCommands: ['npm test'],
      clineMessages: [
        {
          type: 'say',
          say: 'task',
          ts: Date.now() - 2000,
          text: 'Initial task'
        }
      ]
    })

    // Then send the command ask message
    mockPostMessage({
      alwaysAllowExecute: true,
      allowedCommands: ['npm test'],
      clineMessages: [
        {
          type: 'say',
          say: 'task',
          ts: Date.now() - 2000,
          text: 'Initial task'
        },
        {
          type: 'ask',
          ask: 'command',
          ts: Date.now(),
          text: 'npm test',
          partial: false
        }
      ]
    })

    // Wait for the auto-approval message
    await waitFor(() => {
      expect(vscode.postMessage).toHaveBeenCalledWith({
        type: 'askResponse',
        askResponse: 'yesButtonClicked'
      })
    })
  })

  it('does not auto-approve disallowed commands even when alwaysAllowExecute is enabled', () => {
    render(
      <ExtensionStateContextProvider>
        <ChatView 
          isHidden={false}
          showAnnouncement={false}
          hideAnnouncement={() => {}}
          showHistoryView={() => {}}
        />
      </ExtensionStateContextProvider>
    )

    // First hydrate state with initial task
    mockPostMessage({
      alwaysAllowExecute: true,
      allowedCommands: ['npm test'],
      clineMessages: [
        {
          type: 'say',
          say: 'task',
          ts: Date.now() - 2000,
          text: 'Initial task'
        }
      ]
    })

    // Then send the disallowed command ask message
    mockPostMessage({
      alwaysAllowExecute: true,
      allowedCommands: ['npm test'],
      clineMessages: [
        {
          type: 'say',
          say: 'task',
          ts: Date.now() - 2000,
          text: 'Initial task'
        },
        {
          type: 'ask',
          ask: 'command',
          ts: Date.now(),
          text: 'rm -rf /',
          partial: false
        }
      ]
    })

    // Verify no auto-approval message was sent
    expect(vscode.postMessage).not.toHaveBeenCalledWith({
      type: 'askResponse',
      askResponse: 'yesButtonClicked'
    })
  })

  describe('Command Chaining Tests', () => {
    it('auto-approves chained commands when all parts are allowed', async () => {
      render(
        <ExtensionStateContextProvider>
          <ChatView
            isHidden={false}
            showAnnouncement={false}
            hideAnnouncement={() => {}}
            showHistoryView={() => {}}
          />
        </ExtensionStateContextProvider>
      )

      // Test various allowed command chaining scenarios
      const allowedChainedCommands = [
        'npm test && npm run build',
        'npm test; npm run build',
        'npm test || npm run build',
        'npm test | npm run build',
        // Add test for quoted pipes which should be treated as part of the command, not as a chain operator
        'echo "hello | world"',
        'npm test "param with | inside" && npm run build',
        // PowerShell command with Select-String
        'npm test 2>&1 | Select-String -NotMatch "node_modules" | Select-String "FAIL|Error"'
      ]

      for (const command of allowedChainedCommands) {
        jest.clearAllMocks()

        // First hydrate state with initial task
        mockPostMessage({
          alwaysAllowExecute: true,
          allowedCommands: ['npm test', 'npm run build', 'echo', 'Select-String'],
          clineMessages: [
            {
              type: 'say',
              say: 'task',
              ts: Date.now() - 2000,
              text: 'Initial task'
            }
          ]
        })

        // Then send the chained command ask message
        mockPostMessage({
          alwaysAllowExecute: true,
          allowedCommands: ['npm test', 'npm run build', 'echo', 'Select-String'],
          clineMessages: [
            {
              type: 'say',
              say: 'task',
              ts: Date.now() - 2000,
              text: 'Initial task'
            },
            {
              type: 'ask',
              ask: 'command',
              ts: Date.now(),
              text: command,
              partial: false
            }
          ]
        })

        // Wait for the auto-approval message
        await waitFor(() => {
          expect(vscode.postMessage).toHaveBeenCalledWith({
            type: 'askResponse',
            askResponse: 'yesButtonClicked'
          })
        })
      }
    })

    it('does not auto-approve chained commands when any part is disallowed', () => {
      render(
        <ExtensionStateContextProvider>
          <ChatView
            isHidden={false}
            showAnnouncement={false}
            hideAnnouncement={() => {}}
            showHistoryView={() => {}}
          />
        </ExtensionStateContextProvider>
      )

      // Test various command chaining scenarios with disallowed parts
      const disallowedChainedCommands = [
        'npm test && rm -rf /',
        'npm test; rm -rf /',
        'npm test || rm -rf /',
        'npm test | rm -rf /',
        // Test subshell execution using $() and backticks
        'npm test $(echo dangerous)',
        'npm test `echo dangerous`',
        // Test unquoted pipes with disallowed commands
        'npm test | rm -rf /',
        // Test PowerShell command with disallowed parts
        'npm test 2>&1 | Select-String -NotMatch "node_modules" | rm -rf /'
      ]

      disallowedChainedCommands.forEach(command => {
        // First hydrate state with initial task
        mockPostMessage({
          alwaysAllowExecute: true,
          allowedCommands: ['npm test', 'Select-String'],
          clineMessages: [
            {
              type: 'say',
              say: 'task',
              ts: Date.now() - 2000,
              text: 'Initial task'
            }
          ]
        })

        // Then send the chained command ask message
        mockPostMessage({
          alwaysAllowExecute: true,
          allowedCommands: ['npm test', 'Select-String'],
          clineMessages: [
            {
              type: 'say',
              say: 'task',
              ts: Date.now() - 2000,
              text: 'Initial task'
            },
            {
              type: 'ask',
              ask: 'command',
              ts: Date.now(),
              text: command,
              partial: false
            }
          ]
        })

        // Verify no auto-approval message was sent for chained commands with disallowed parts
        expect(vscode.postMessage).not.toHaveBeenCalledWith({
          type: 'askResponse',
          askResponse: 'yesButtonClicked'
        })
      })
    })

    it('handles complex PowerShell command chains correctly', async () => {
      render(
        <ExtensionStateContextProvider>
          <ChatView
            isHidden={false}
            showAnnouncement={false}
            hideAnnouncement={() => {}}
            showHistoryView={() => {}}
          />
        </ExtensionStateContextProvider>
      )

      // Test PowerShell specific command chains
      const powershellCommands = {
        allowed: [
          'npm test 2>&1 | Select-String -NotMatch "node_modules"',
          'npm test 2>&1 | Select-String "FAIL|Error"',
          'npm test 2>&1 | Select-String -NotMatch "node_modules" | Select-String "FAIL|Error"'
        ],
        disallowed: [
          'npm test 2>&1 | Select-String -NotMatch "node_modules" | rm -rf /',
          'npm test 2>&1 | Select-String "FAIL|Error" && del /F /Q *',
          'npm test 2>&1 | Select-String -NotMatch "node_modules" | Remove-Item -Recurse'
        ]
      }

      // Test allowed PowerShell commands
      for (const command of powershellCommands.allowed) {
        jest.clearAllMocks()

        mockPostMessage({
          alwaysAllowExecute: true,
          allowedCommands: ['npm test', 'Select-String'],
          clineMessages: [
            {
              type: 'say',
              say: 'task',
              ts: Date.now() - 2000,
              text: 'Initial task'
            }
          ]
        })

        mockPostMessage({
          alwaysAllowExecute: true,
          allowedCommands: ['npm test', 'Select-String'],
          clineMessages: [
            {
              type: 'say',
              say: 'task',
              ts: Date.now() - 2000,
              text: 'Initial task'
            },
            {
              type: 'ask',
              ask: 'command',
              ts: Date.now(),
              text: command,
              partial: false
            }
          ]
        })

        await waitFor(() => {
          expect(vscode.postMessage).toHaveBeenCalledWith({
            type: 'askResponse',
            askResponse: 'yesButtonClicked'
          })
        })
      }

      // Test disallowed PowerShell commands
      for (const command of powershellCommands.disallowed) {
        jest.clearAllMocks()

        mockPostMessage({
          alwaysAllowExecute: true,
          allowedCommands: ['npm test', 'Select-String'],
          clineMessages: [
            {
              type: 'say',
              say: 'task',
              ts: Date.now() - 2000,
              text: 'Initial task'
            }
          ]
        })

        mockPostMessage({
          alwaysAllowExecute: true,
          allowedCommands: ['npm test', 'Select-String'],
          clineMessages: [
            {
              type: 'say',
              say: 'task',
              ts: Date.now() - 2000,
              text: 'Initial task'
            },
            {
              type: 'ask',
              ask: 'command',
              ts: Date.now(),
              text: command,
              partial: false
            }
          ]
        })

        expect(vscode.postMessage).not.toHaveBeenCalledWith({
          type: 'askResponse',
          askResponse: 'yesButtonClicked'
        })
      }
    })
  })
})

describe('ChatView - Sound Playing Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('does not play sound for auto-approved browser actions', async () => {
    render(
      <ExtensionStateContextProvider>
        <ChatView 
          isHidden={false}
          showAnnouncement={false}
          hideAnnouncement={() => {}}
          showHistoryView={() => {}}
        />
      </ExtensionStateContextProvider>
    )

    // First hydrate state with initial task and streaming
    mockPostMessage({
      alwaysAllowBrowser: true,
      clineMessages: [
        {
          type: 'say',
          say: 'task',
          ts: Date.now() - 2000,
          text: 'Initial task'
        },
        {
          type: 'say',
          say: 'api_req_started',
          ts: Date.now() - 1000,
          text: JSON.stringify({}),
          partial: true
        }
      ]
    })

    // Then send the browser action ask message (streaming finished)
    mockPostMessage({
      alwaysAllowBrowser: true,
      clineMessages: [
        {
          type: 'say',
          say: 'task',
          ts: Date.now() - 2000,
          text: 'Initial task'
        },
        {
          type: 'ask',
          ask: 'browser_action_launch',
          ts: Date.now(),
          text: JSON.stringify({ action: 'launch', url: 'http://example.com' }),
          partial: false
        }
      ]
    })

    // Verify no sound was played
    expect(vscode.postMessage).not.toHaveBeenCalledWith({
      type: 'playSound',
      audioType: expect.any(String)
    })
  })

  it('plays notification sound for non-auto-approved browser actions', async () => {
    render(
      <ExtensionStateContextProvider>
        <ChatView 
          isHidden={false}
          showAnnouncement={false}
          hideAnnouncement={() => {}}
          showHistoryView={() => {}}
        />
      </ExtensionStateContextProvider>
    )

    // First hydrate state with initial task and streaming
    mockPostMessage({
      alwaysAllowBrowser: false,
      clineMessages: [
        {
          type: 'say',
          say: 'task',
          ts: Date.now() - 2000,
          text: 'Initial task'
        },
        {
          type: 'say',
          say: 'api_req_started',
          ts: Date.now() - 1000,
          text: JSON.stringify({}),
          partial: true
        }
      ]
    })

    // Then send the browser action ask message (streaming finished)
    mockPostMessage({
      alwaysAllowBrowser: false,
      clineMessages: [
        {
          type: 'say',
          say: 'task',
          ts: Date.now() - 2000,
          text: 'Initial task'
        },
        {
          type: 'ask',
          ask: 'browser_action_launch',
          ts: Date.now(),
          text: JSON.stringify({ action: 'launch', url: 'http://example.com' }),
          partial: false
        }
      ]
    })

    // Verify notification sound was played
    await waitFor(() => {
      expect(vscode.postMessage).toHaveBeenCalledWith({
        type: 'playSound',
        audioType: 'notification'
      })
    })
  })

  it('plays celebration sound for completion results', async () => {
    render(
      <ExtensionStateContextProvider>
        <ChatView 
          isHidden={false}
          showAnnouncement={false}
          hideAnnouncement={() => {}}
          showHistoryView={() => {}}
        />
      </ExtensionStateContextProvider>
    )

    // First hydrate state with initial task and streaming
    mockPostMessage({
      clineMessages: [
        {
          type: 'say',
          say: 'task',
          ts: Date.now() - 2000,
          text: 'Initial task'
        },
        {
          type: 'say',
          say: 'api_req_started',
          ts: Date.now() - 1000,
          text: JSON.stringify({}),
          partial: true
        }
      ]
    })

    // Then send the completion result message (streaming finished)
    mockPostMessage({
      clineMessages: [
        {
          type: 'say',
          say: 'task',
          ts: Date.now() - 2000,
          text: 'Initial task'
        },
        {
          type: 'ask',
          ask: 'completion_result',
          ts: Date.now(),
          text: 'Task completed successfully',
          partial: false
        }
      ]
    })

    // Verify celebration sound was played
    await waitFor(() => {
      expect(vscode.postMessage).toHaveBeenCalledWith({
        type: 'playSound',
        audioType: 'celebration'
      })
    })
  })

  it('plays progress_loop sound for api failures', async () => {
    render(
      <ExtensionStateContextProvider>
        <ChatView 
          isHidden={false}
          showAnnouncement={false}
          hideAnnouncement={() => {}}
          showHistoryView={() => {}}
        />
      </ExtensionStateContextProvider>
    )

    // First hydrate state with initial task and streaming
    mockPostMessage({
      clineMessages: [
        {
          type: 'say',
          say: 'task',
          ts: Date.now() - 2000,
          text: 'Initial task'
        },
        {
          type: 'say',
          say: 'api_req_started',
          ts: Date.now() - 1000,
          text: JSON.stringify({}),
          partial: true
        }
      ]
    })

    // Then send the api failure message (streaming finished)
    mockPostMessage({
      clineMessages: [
        {
          type: 'say',
          say: 'task',
          ts: Date.now() - 2000,
          text: 'Initial task'
        },
        {
          type: 'ask',
          ask: 'api_req_failed',
          ts: Date.now(),
          text: 'API request failed',
          partial: false
        }
      ]
    })

    // Verify progress_loop sound was played
    await waitFor(() => {
      expect(vscode.postMessage).toHaveBeenCalledWith({
        type: 'playSound',
        audioType: 'progress_loop'
      })
    })
  })
})
