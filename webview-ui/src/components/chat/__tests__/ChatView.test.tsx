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

  it('auto-approves write tools when alwaysAllowWrite is enabled', async () => {
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
        'npm test | npm run build'
      ]

      for (const command of allowedChainedCommands) {
        jest.clearAllMocks()

        // First hydrate state with initial task
        mockPostMessage({
          alwaysAllowExecute: true,
          allowedCommands: ['npm test', 'npm run build'],
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
          allowedCommands: ['npm test', 'npm run build'],
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
        'npm test $(echo dangerous)',
        'npm test `echo dangerous`'
      ]

      disallowedChainedCommands.forEach(command => {
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

        // Then send the chained command ask message
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
  })
})
