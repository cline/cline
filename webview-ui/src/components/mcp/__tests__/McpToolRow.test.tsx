import React from 'react'
import { render, fireEvent, screen } from '@testing-library/react'
import McpToolRow from '../McpToolRow'
import { vscode } from '../../../utils/vscode'

jest.mock('../../../utils/vscode', () => ({
  vscode: {
    postMessage: jest.fn()
  }
}))

jest.mock('@vscode/webview-ui-toolkit/react', () => ({
  VSCodeCheckbox: function MockVSCodeCheckbox({
    children,
    checked,
    onChange
  }: {
    children?: React.ReactNode;
    checked?: boolean;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  }) {
    return (
      <label>
        <input
          type="checkbox"
          checked={checked}
          onChange={onChange}
        />
        {children}
      </label>
    )
  }
}))

describe('McpToolRow', () => {
  const mockTool = {
    name: 'test-tool',
    description: 'A test tool',
    alwaysAllow: false
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders tool name and description', () => {
    render(<McpToolRow tool={mockTool} />)
    
    expect(screen.getByText('test-tool')).toBeInTheDocument()
    expect(screen.getByText('A test tool')).toBeInTheDocument()
  })

  it('does not show always allow checkbox when serverName is not provided', () => {
    render(<McpToolRow tool={mockTool} />)
    
    expect(screen.queryByText('Always allow')).not.toBeInTheDocument()
  })

  it('shows always allow checkbox when serverName and alwaysAllowMcp are provided', () => {
    render(<McpToolRow tool={mockTool} serverName="test-server" alwaysAllowMcp={true} />)
    
    expect(screen.getByText('Always allow')).toBeInTheDocument()
  })
  
  it('sends message to toggle always allow when checkbox is clicked', () => {
    render(<McpToolRow tool={mockTool} serverName="test-server" alwaysAllowMcp={true} />)
    
    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox)
  
    expect(vscode.postMessage).toHaveBeenCalledWith({
      type: 'toggleToolAlwaysAllow',
      serverName: 'test-server',
      toolName: 'test-tool',
      alwaysAllow: true
    })
  })
  
  it('reflects always allow state in checkbox', () => {
    const alwaysAllowedTool = {
      ...mockTool,
      alwaysAllow: true
    }
  
    render(<McpToolRow tool={alwaysAllowedTool} serverName="test-server" alwaysAllowMcp={true} />)
    
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement
    expect(checkbox.checked).toBe(true)
  })
  
  it('prevents event propagation when clicking the checkbox', () => {
    const mockOnClick = jest.fn()
    render(
      <div onClick={mockOnClick}>
        <McpToolRow tool={mockTool} serverName="test-server" alwaysAllowMcp={true} />
      </div>
    )
    
    const container = screen.getByTestId('tool-row-container')
    fireEvent.click(container)
    
    expect(mockOnClick).not.toHaveBeenCalled()
  })

  it('displays input schema parameters when provided', () => {
    const toolWithSchema = {
      ...mockTool,
      inputSchema: {
        type: 'object',
        properties: {
          param1: {
            type: 'string',
            description: 'First parameter'
          },
          param2: {
            type: 'number',
            description: 'Second parameter'
          }
        },
        required: ['param1']
      }
    }

    render(<McpToolRow tool={toolWithSchema} serverName="test-server" />)
    
    expect(screen.getByText('Parameters')).toBeInTheDocument()
    expect(screen.getByText('param1')).toBeInTheDocument()
    expect(screen.getByText('param2')).toBeInTheDocument()
    expect(screen.getByText('First parameter')).toBeInTheDocument()
    expect(screen.getByText('Second parameter')).toBeInTheDocument()
  })
})