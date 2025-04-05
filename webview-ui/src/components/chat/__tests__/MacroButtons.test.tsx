import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import MacroButtons from '../MacroButtons'
import { vscode } from '../../../utils/vscode'

// Mock the vscode API
jest.mock('../../../utils/vscode', () => ({
  vscode: {
    postMessage: jest.fn(),
  },
}))

describe('MacroButtons', () => {
  const mockMacroButtons = [
    {
      id: 'test-macro-1',
      label: 'Test Macro 1',
      action: 'Test action 1',
    },
    {
      id: 'test-macro-2',
      label: 'Test Macro 2',
      action: 'Test action 2',
    },
  ]

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders nothing when no macro buttons provided', () => {
    const { container } = render(<MacroButtons isInputDisabled={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when empty macro buttons array provided', () => {
    const { container } = render(<MacroButtons macroButtons={[]} isInputDisabled={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders macro buttons and manage button', () => {
    render(<MacroButtons macroButtons={mockMacroButtons} isInputDisabled={false} />)
    
    expect(screen.getByText('Test Macro 1')).toBeInTheDocument()
    expect(screen.getByText('Test Macro 2')).toBeInTheDocument()
    expect(screen.getByText('Manage')).toBeInTheDocument()
  })

  it('sends the correct message when a macro button is clicked', () => {
    render(<MacroButtons macroButtons={mockMacroButtons} isInputDisabled={false} />)
    
    fireEvent.click(screen.getByText('Test Macro 1'))
    
    expect(vscode.postMessage).toHaveBeenCalledWith({
      type: 'invoke',
      invoke: 'sendMessage',
      text: 'Test action 1',
    })
  })

  it('sends the correct message when the manage button is clicked', () => {
    render(<MacroButtons macroButtons={mockMacroButtons} isInputDisabled={false} />)
    
    fireEvent.click(screen.getByText('Manage'))
    
    expect(vscode.postMessage).toHaveBeenCalledWith({
      type: 'action',
      action: 'manageMacrosClicked',
    })
  })

  it('disables all buttons when isInputDisabled is true', () => {
    render(<MacroButtons macroButtons={mockMacroButtons} isInputDisabled={true} />)
    
    const buttons = screen.getAllByRole('button')
    buttons.forEach(button => {
      expect(button).toBeDisabled()
    })
  })
})
