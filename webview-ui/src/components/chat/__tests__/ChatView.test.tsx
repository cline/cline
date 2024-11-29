import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExtensionStateContextType } from '../../../context/ExtensionStateContext'
import ChatView from '../ChatView'
import { vscode } from '../../../utils/vscode'
import * as ExtensionStateContext from '../../../context/ExtensionStateContext'

// Mock vscode
jest.mock('../../../utils/vscode', () => ({
    vscode: {
        postMessage: jest.fn()
    }
}))

// Mock all components that use problematic dependencies
jest.mock('../../common/CodeBlock', () => ({
    __esModule: true,
    default: () => <div data-testid="mock-code-block" />
}))

jest.mock('../../common/MarkdownBlock', () => ({
    __esModule: true,
    default: () => <div data-testid="mock-markdown-block" />
}))

jest.mock('../BrowserSessionRow', () => ({
    __esModule: true,
    default: () => <div data-testid="mock-browser-session-row" />
}))

// Update ChatRow mock to capture props
let chatRowProps = null
jest.mock('../ChatRow', () => ({
    __esModule: true,
    default: (props: any) => {
        chatRowProps = props
        return <div data-testid="mock-chat-row" />
    }
}))

// Mock Virtuoso component
jest.mock('react-virtuoso', () => ({
    Virtuoso: ({ children }: any) => (
        <div data-testid="mock-virtuoso">{children}</div>
    )
}))

// Mock VS Code components
jest.mock('@vscode/webview-ui-toolkit/react', () => ({
    VSCodeButton: ({ children, onClick }: any) => (
        <button onClick={onClick}>{children}</button>
    ),
    VSCodeProgressRing: () => <div data-testid="progress-ring" />
}))

describe('ChatView', () => {
    const mockShowHistoryView = jest.fn()
    const mockHideAnnouncement = jest.fn()

    let mockState: ExtensionStateContextType

    beforeEach(() => {
        jest.clearAllMocks()
        
        mockState = {
            clineMessages: [],
            apiConfiguration: {
                apiProvider: 'anthropic',
                apiModelId: 'claude-3-sonnet'
            },
            version: '1.0.0',
            customInstructions: '',
            alwaysAllowReadOnly: true,
            alwaysAllowWrite: true,
            alwaysAllowExecute: true,
            alwaysAllowBrowser: true,
            openRouterModels: {},
            didHydrateState: true,
            showWelcome: false,
            theme: 'dark',
            filePaths: [],
            taskHistory: [],
            shouldShowAnnouncement: false,
            uriScheme: 'vscode',

            setApiConfiguration: jest.fn(),
            setShowAnnouncement: jest.fn(),
            setCustomInstructions: jest.fn(),
            setAlwaysAllowReadOnly: jest.fn(),
            setAlwaysAllowWrite: jest.fn(),
            setAlwaysAllowExecute: jest.fn(),
            setAlwaysAllowBrowser: jest.fn()
        }
        
        // Mock the useExtensionState hook
        jest.spyOn(ExtensionStateContext, 'useExtensionState').mockReturnValue(mockState)
    })

    const renderChatView = () => {
        return render(
            <ChatView 
                isHidden={false}
                showAnnouncement={false}
                hideAnnouncement={mockHideAnnouncement}
                showHistoryView={mockShowHistoryView}
            />
        )
    }

    describe('Always Allow Logic', () => {
        it('should auto-approve read-only tool actions when alwaysAllowReadOnly is true', () => {
            mockState.clineMessages = [
                { 
                    type: 'ask',
                    ask: 'tool',
                    text: JSON.stringify({ tool: 'readFile' }),
                    ts: Date.now(),
                }
            ]
            renderChatView()
            
            expect(vscode.postMessage).toHaveBeenCalledWith({
                type: 'askResponse',
                askResponse: 'yesButtonClicked'
            })
        })

        it('should auto-approve all file listing tool types when alwaysAllowReadOnly is true', () => {
            const fileListingTools = [
                'readFile', 'listFiles', 'listFilesTopLevel',
                'listFilesRecursive', 'listCodeDefinitionNames', 'searchFiles'
            ]

            fileListingTools.forEach(tool => {
                jest.clearAllMocks()
                mockState.clineMessages = [
                    { 
                        type: 'ask',
                        ask: 'tool',
                        text: JSON.stringify({ tool }),
                        ts: Date.now(),
                    }
                ]
                renderChatView()

                expect(vscode.postMessage).toHaveBeenCalledWith({
                    type: 'askResponse',
                    askResponse: 'yesButtonClicked'
                })
            })
        })

        it('should auto-approve write tool actions when alwaysAllowWrite is true', () => {
            mockState.clineMessages = [
                { 
                    type: 'ask',
                    ask: 'tool',
                    text: JSON.stringify({ tool: 'editedExistingFile' }),
                    ts: Date.now(),
                }
            ]
            renderChatView()
            
            expect(vscode.postMessage).toHaveBeenCalledWith({
                type: 'askResponse',
                askResponse: 'yesButtonClicked'
            })
        })

        it('should auto-approve allowed execute commands when alwaysAllowExecute is true', () => {
            mockState.clineMessages = [
                { 
                    type: 'ask',
                    ask: 'command',
                    text: 'npm install',
                    ts: Date.now(),
                }
            ]
            renderChatView()
            
            expect(vscode.postMessage).toHaveBeenCalledWith({
                type: 'askResponse',
                askResponse: 'yesButtonClicked'
            })
        })

        it('should not auto-approve disallowed execute commands even when alwaysAllowExecute is true', () => {
            mockState.clineMessages = [
                { 
                    type: 'ask',
                    ask: 'command',
                    text: 'rm -rf /',
                    ts: Date.now(),
                }
            ]
            renderChatView()
            
            expect(vscode.postMessage).not.toHaveBeenCalled()
        })

        it('should not auto-approve commands with chaining characters when alwaysAllowExecute is true', () => {
            mockState.clineMessages = [
                { 
                    type: 'ask',
                    ask: 'command',
                    text: 'npm install && rm -rf /',
                    ts: Date.now(),
                }
            ]
            renderChatView()
            
            expect(vscode.postMessage).not.toHaveBeenCalled()
        })

        it('should auto-approve browser actions when alwaysAllowBrowser is true', () => {
            mockState.clineMessages = [
                { 
                    type: 'ask',
                    ask: 'browser_action_launch',
                    ts: Date.now(),
                }
            ]
            renderChatView()
            
            expect(vscode.postMessage).toHaveBeenCalledWith({
                type: 'askResponse',
                askResponse: 'yesButtonClicked'
            })
        })

        it('should not auto-approve when corresponding alwaysAllow flag is false', () => {
            mockState.alwaysAllowReadOnly = false
            mockState.clineMessages = [
                { 
                    type: 'ask',
                    ask: 'tool',
                    text: JSON.stringify({ tool: 'readFile' }),
                    ts: Date.now(),
                }
            ]
            renderChatView()
            
            expect(vscode.postMessage).not.toHaveBeenCalled()
        })
    })

    describe('Streaming State', () => {
        it('should show cancel button while streaming and trigger cancel on click', async () => {
            mockState.clineMessages = [
                { 
                    type: 'say',
                    say: 'task',
                    ts: Date.now(),
                },
                { 
                    type: 'say',
                    say: 'text',
                    partial: true,
                    ts: Date.now(),
                }
            ]
            renderChatView()
            
            const cancelButton = screen.getByText('Cancel')
            await userEvent.click(cancelButton)
            
            expect(vscode.postMessage).toHaveBeenCalledWith({
                type: 'cancelTask'
            })
        })

        it('should show terminate button when task is paused and trigger terminate on click', async () => {
            mockState.clineMessages = [
                { 
                    type: 'ask',
                    ask: 'resume_task',
                    ts: Date.now(),
                }
            ]
            renderChatView()
            
            const terminateButton = screen.getByText('Terminate')
            await userEvent.click(terminateButton)
            
            expect(vscode.postMessage).toHaveBeenCalledWith({
                type: 'clearTask'
            })
        })

        it('should show retry button when API error occurs and trigger retry on click', async () => {
            mockState.clineMessages = [
                { 
                    type: 'ask',
                    ask: 'api_req_failed',
                    ts: Date.now(),
                }
            ]
            renderChatView()
            
            const retryButton = screen.getByText('Retry')
            await userEvent.click(retryButton)
            
            expect(vscode.postMessage).toHaveBeenCalledWith({
                type: 'askResponse',
                askResponse: 'yesButtonClicked'
            })
        })
    })
})
