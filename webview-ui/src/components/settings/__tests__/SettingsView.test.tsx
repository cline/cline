import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExtensionStateContextType } from '../../../context/ExtensionStateContext'
import SettingsView from '../SettingsView'
import { vscode } from '../../../utils/vscode'
import * as ExtensionStateContext from '../../../context/ExtensionStateContext'
import { ModelInfo } from '../../../../../src/shared/api'

// Mock dependencies
jest.mock('../../../utils/vscode', () => ({
    vscode: {
        postMessage: jest.fn()
    }
}))

// Mock validation functions
jest.mock('../../../utils/validate', () => ({
    validateApiConfiguration: jest.fn(() => undefined),
    validateModelId: jest.fn(() => undefined)
}))

// Mock ApiOptions component
jest.mock('../ApiOptions', () => ({
    __esModule: true,
    default: () => <div data-testid="mock-api-options" />
}))

// Mock VS Code components
jest.mock('@vscode/webview-ui-toolkit/react', () => ({
    VSCodeButton: ({ children, onClick }: any) => (
        <button onClick={onClick}>{children}</button>
    ),
    VSCodeCheckbox: ({ children, checked, onChange }: any) => (
        <label>
            <input
                type="checkbox"
                checked={checked}
                onChange={e => onChange(e)}
                aria-checked={checked}
            />
            {children}
        </label>
    ),
    VSCodeTextArea: ({ children, value, onInput }: any) => (
        <textarea
            data-testid="custom-instructions"
            value={value}
            readOnly
            aria-label="Custom Instructions"
        >{children}</textarea>
    ),
    VSCodeLink: ({ children, href }: any) => (
        <a href={href}>{children}</a>
    )
}))

describe('SettingsView', () => {
    const mockOnDone = jest.fn()
    const mockSetAlwaysAllowWrite = jest.fn()
    const mockSetAlwaysAllowReadOnly = jest.fn()
    const mockSetCustomInstructions = jest.fn()
    const mockSetAlwaysAllowExecute = jest.fn()

    let mockState: ExtensionStateContextType

    const mockOpenRouterModels: Record<string, ModelInfo> = {
        'claude-3-sonnet': {
            maxTokens: 200000,
            contextWindow: 200000,
            supportsImages: true,
            supportsComputerUse: true,
            supportsPromptCache: true,
            inputPrice: 0.000008,
            outputPrice: 0.000024,
            description: "Anthropic's Claude 3 Sonnet model"
        }
    }

    beforeEach(() => {
        jest.clearAllMocks()
        
        mockState = {
            apiConfiguration: {
                apiProvider: 'anthropic',
                apiModelId: 'claude-3-sonnet'
            },
            version: '1.0.0',
            customInstructions: 'Test instructions',
            alwaysAllowReadOnly: true,
            alwaysAllowWrite: true,
            alwaysAllowExecute: true,
            openRouterModels: mockOpenRouterModels,
            didHydrateState: true,
            showWelcome: false,
            theme: 'dark',
            filePaths: [],
            taskHistory: [],
            shouldShowAnnouncement: false,
            clineMessages: [],
            uriScheme: 'vscode',
            
            setAlwaysAllowReadOnly: mockSetAlwaysAllowReadOnly,
            setAlwaysAllowWrite: mockSetAlwaysAllowWrite,
            setCustomInstructions: mockSetCustomInstructions,
            setAlwaysAllowExecute: mockSetAlwaysAllowExecute,
            setApiConfiguration: jest.fn(),
            setShowAnnouncement: jest.fn()
        }
        
        // Mock the useExtensionState hook
        jest.spyOn(ExtensionStateContext, 'useExtensionState').mockReturnValue(mockState)
    })

    const renderSettingsView = () => {
        return render(
            <SettingsView onDone={mockOnDone} />
        )
    }

    describe('Checkboxes', () => {
        it('should toggle alwaysAllowWrite checkbox', async () => {
            mockState.alwaysAllowWrite = false
            renderSettingsView()
            
            const writeCheckbox = screen.getByRole('checkbox', {
                name: /Always approve write operations/i
            })
            
            expect(writeCheckbox).not.toBeChecked()
            await act(async () => {
                await userEvent.click(writeCheckbox)
            })
            expect(mockSetAlwaysAllowWrite).toHaveBeenCalledWith(true)
        })

        it('should toggle alwaysAllowExecute checkbox', async () => {
            mockState.alwaysAllowExecute = false
            renderSettingsView()
            
            const executeCheckbox = screen.getByRole('checkbox', {
                name: /Always approve execute operations/i
            })
            
            expect(executeCheckbox).not.toBeChecked()
            await act(async () => {
                await userEvent.click(executeCheckbox)
            })
            expect(mockSetAlwaysAllowExecute).toHaveBeenCalledWith(true)
        })

        it('should toggle alwaysAllowReadOnly checkbox', async () => {
            mockState.alwaysAllowReadOnly = false
            renderSettingsView()
            
            const readOnlyCheckbox = screen.getByRole('checkbox', {
                name: /Always approve read-only operations/i
            })
            
            expect(readOnlyCheckbox).not.toBeChecked()
            await act(async () => {
                await userEvent.click(readOnlyCheckbox)
            })
            expect(mockSetAlwaysAllowReadOnly).toHaveBeenCalledWith(true)
        })
    })

    describe('Form Submission', () => {
        it('should send correct messages when form is submitted', async () => {
            renderSettingsView()

            // Submit form
            const doneButton = screen.getByRole('button', { name: /Done/i })
            await act(async () => {
                await userEvent.click(doneButton)
            })

            // Verify messages were sent in the correct order
            const calls = (vscode.postMessage as jest.Mock).mock.calls
            expect(calls).toHaveLength(5)
            
            expect(calls[0][0]).toEqual({
                type: 'apiConfiguration',
                apiConfiguration: {
                    apiProvider: 'anthropic',
                    apiModelId: 'claude-3-sonnet'
                }
            })

            expect(calls[1][0]).toEqual({
                type: 'customInstructions',
                text: 'Test instructions'
            })

            expect(calls[2][0]).toEqual({
                type: 'alwaysAllowReadOnly',
                bool: true
            })

            expect(calls[3][0]).toEqual({
                type: 'alwaysAllowWrite',
                bool: true
            })

            expect(calls[4][0]).toEqual({
                type: 'alwaysAllowExecute',
                bool: true
            })

            // Verify onDone was called
            expect(mockOnDone).toHaveBeenCalled()
        })
    })

    describe('Accessibility', () => {
        it('should have accessible form controls', () => {
            renderSettingsView()

            // Check for proper labels and ARIA attributes
            const writeCheckbox = screen.getByRole('checkbox', {
                name: /Always approve write operations/i
            })
            expect(writeCheckbox).toHaveAttribute('aria-checked')

            const textarea = screen.getByRole('textbox', {
                name: /Custom Instructions/i
            })
            expect(textarea).toBeInTheDocument()
        })
    })
})
