import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import SettingsView from '../SettingsView'
import { ExtensionStateContextProvider } from '../../../context/ExtensionStateContext'
import { vscode } from '../../../utils/vscode'

// Mock vscode API
jest.mock('../../../utils/vscode', () => ({
  vscode: {
    postMessage: jest.fn(),
  },
}))

// Mock VSCode components
jest.mock('@vscode/webview-ui-toolkit/react', () => ({
  VSCodeButton: ({ children, onClick, appearance }: any) => (
    appearance === 'icon' ? 
      <button onClick={onClick} className="codicon codicon-close" aria-label="Remove command">
        <span className="codicon codicon-close" />
      </button> :
      <button onClick={onClick} data-appearance={appearance}>{children}</button>
  ),
  VSCodeCheckbox: ({ children, onChange, checked }: any) => (
    <label>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange({ target: { checked: e.target.checked } })}
        aria-label={typeof children === 'string' ? children : undefined}
      />
      {children}
    </label>
  ),
  VSCodeTextField: ({ value, onInput, placeholder }: any) => (
    <input
      type="text"
      value={value}
      onChange={(e) => onInput({ target: { value: e.target.value } })}
      placeholder={placeholder}
    />
  ),
  VSCodeTextArea: () => <textarea />,
  VSCodeLink: () => <a />,
  VSCodeDropdown: ({ children, value, onChange }: any) => (
    <select value={value} onChange={onChange}>
      {children}
    </select>
  ),
  VSCodeOption: ({ children, value }: any) => (
    <option value={value}>{children}</option>
  ),
  VSCodeRadio: ({ children, value, checked, onChange }: any) => (
    <input
      type="radio"
      value={value}
      checked={checked}
      onChange={onChange}
    />
  ),
  VSCodeRadioGroup: ({ children, value, onChange }: any) => (
    <div onChange={onChange}>
      {children}
    </div>
  )
}))

// Mock window.postMessage to trigger state hydration
const mockPostMessage = (state: any) => {
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

const renderSettingsView = () => {
  const onDone = jest.fn()
  render(
    <ExtensionStateContextProvider>
      <SettingsView onDone={onDone} />
    </ExtensionStateContextProvider>
  )
  // Hydrate initial state
  mockPostMessage({})
  return { onDone }
}

describe('SettingsView - Sound Settings', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('initializes with sound disabled by default', () => {
    renderSettingsView()
    
    const soundCheckbox = screen.getByRole('checkbox', {
      name: /Enable sound effects/i
    })
    expect(soundCheckbox).not.toBeChecked()
  })

  it('toggles sound setting and sends message to VSCode', () => {
    renderSettingsView()
    
    const soundCheckbox = screen.getByRole('checkbox', {
      name: /Enable sound effects/i
    })
    
    // Enable sound
    fireEvent.click(soundCheckbox)
    expect(soundCheckbox).toBeChecked()
    
    // Click Done to save settings
    const doneButton = screen.getByText('Done')
    fireEvent.click(doneButton)
    
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'soundEnabled',
        bool: true
      })
    )
  })
})

describe('SettingsView - Allowed Commands', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('shows allowed commands section when alwaysAllowExecute is enabled', () => {
    renderSettingsView()
    
    // Enable always allow execute
    const executeCheckbox = screen.getByRole('checkbox', {
      name: /Always approve allowed execute operations/i
    })
    fireEvent.click(executeCheckbox)

    // Verify allowed commands section appears
    expect(screen.getByText(/Allowed Auto-Execute Commands/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Enter command prefix/i)).toBeInTheDocument()
  })

  it('adds new command to the list', () => {
    renderSettingsView()
    
    // Enable always allow execute
    const executeCheckbox = screen.getByRole('checkbox', {
      name: /Always approve allowed execute operations/i
    })
    fireEvent.click(executeCheckbox)

    // Add a new command
    const input = screen.getByPlaceholderText(/Enter command prefix/i)
    fireEvent.change(input, { target: { value: 'npm test' } })
    
    const addButton = screen.getByText('Add')
    fireEvent.click(addButton)

    // Verify command was added
    expect(screen.getByText('npm test')).toBeInTheDocument()
    
    // Verify VSCode message was sent
    expect(vscode.postMessage).toHaveBeenCalledWith({
      type: 'allowedCommands',
      commands: ['npm test']
    })
  })

  it('removes command from the list', () => {
    renderSettingsView()
    
    // Enable always allow execute
    const executeCheckbox = screen.getByRole('checkbox', {
      name: /Always approve allowed execute operations/i
    })
    fireEvent.click(executeCheckbox)

    // Add a command
    const input = screen.getByPlaceholderText(/Enter command prefix/i)
    fireEvent.change(input, { target: { value: 'npm test' } })
    const addButton = screen.getByText('Add')
    fireEvent.click(addButton)

    // Remove the command
    const removeButton = screen.getByRole('button', { name: 'Remove command' })
    fireEvent.click(removeButton)

    // Verify command was removed
    expect(screen.queryByText('npm test')).not.toBeInTheDocument()
    
    // Verify VSCode message was sent
    expect(vscode.postMessage).toHaveBeenLastCalledWith({
      type: 'allowedCommands',
      commands: []
    })
  })

  it('prevents duplicate commands', () => {
    renderSettingsView()
    
    // Enable always allow execute
    const executeCheckbox = screen.getByRole('checkbox', {
      name: /Always approve allowed execute operations/i
    })
    fireEvent.click(executeCheckbox)

    // Add a command twice
    const input = screen.getByPlaceholderText(/Enter command prefix/i)
    const addButton = screen.getByText('Add')

    // First addition
    fireEvent.change(input, { target: { value: 'npm test' } })
    fireEvent.click(addButton)

    // Second addition attempt
    fireEvent.change(input, { target: { value: 'npm test' } })
    fireEvent.click(addButton)

    // Verify command appears only once
    const commands = screen.getAllByText('npm test')
    expect(commands).toHaveLength(1)
  })

  it('saves allowed commands when clicking Done', () => {
    const { onDone } = renderSettingsView()
    
    // Enable always allow execute
    const executeCheckbox = screen.getByRole('checkbox', {
      name: /Always approve allowed execute operations/i
    })
    fireEvent.click(executeCheckbox)

    // Add a command
    const input = screen.getByPlaceholderText(/Enter command prefix/i)
    fireEvent.change(input, { target: { value: 'npm test' } })
    const addButton = screen.getByText('Add')
    fireEvent.click(addButton)

    // Click Done
    const doneButton = screen.getByText('Done')
    fireEvent.click(doneButton)

    // Verify VSCode messages were sent
    expect(vscode.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'allowedCommands',
      commands: ['npm test']
    }))
    expect(onDone).toHaveBeenCalled()
  })
})
