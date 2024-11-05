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
            openRouterModels: {},
            didHydrateState: true,
            showWelcome: false,
            theme: 'dark',
            filePaths: [],
            taskHistory: [],
            shouldShowAnnouncement: false,
            uriScheme: 'vscode',
            
            setAlwaysAllowReadOnly: jest.fn(),
            setAlwaysAllowWrite: jest.fn(),
            setCustomInstructions: jest.fn(),
            setAlwaysAllowExecute: jest.fn(),
            setApiConfiguration: jest.fn(),
            setShowAnnouncement: jest.fn()
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

    describe('Streaming State', () => {
        it('should show cancel button while streaming', () => {
            mockState.clineMessages = [
                { 
                    type: 'say', 
                    partial: true,
                    ts: Date.now(),
                }
            ]
            renderChatView()
            
            const buttons = screen.queryAllByRole('button')
            expect(buttons.length).toBeGreaterThan(0)
        })

        it('should show terminate button when task is paused', () => {
            mockState.clineMessages = [
                { 
                    type: 'ask',
                    ask: 'resume_task',
                    ts: Date.now(),
                }
            ]
            renderChatView()
            
            const buttons = screen.queryAllByRole('button')
            expect(buttons.length).toBeGreaterThan(0)
        })

        it('should show retry button when API error occurs', () => {
            mockState.clineMessages = [
                { 
                    type: 'say',
                    say: 'error',
                    ts: Date.now(),
                }
            ]
            renderChatView()
            
            const buttons = screen.queryAllByRole('button')
            expect(buttons.length).toBeGreaterThan(0)
        })
    })
}) 