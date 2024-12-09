import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import HistoryView from '../HistoryView'
import { ExtensionStateContextProvider } from '../../../context/ExtensionStateContext'
import { vscode } from '../../../utils/vscode'
import { highlight } from '../HistoryView'
import { FuseResult } from 'fuse.js'

// Mock vscode API
jest.mock('../../../utils/vscode', () => ({
  vscode: {
    postMessage: jest.fn(),
  },
}))

interface VSCodeButtonProps {
  children: React.ReactNode;
  onClick?: (e: any) => void;
  appearance?: string;
  className?: string;
}

interface VSCodeTextFieldProps {
  value?: string;
  onInput?: (e: { target: { value: string } }) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}

interface VSCodeRadioGroupProps {
  children?: React.ReactNode;
  value?: string;
  onChange?: (e: { target: { value: string } }) => void;
  style?: React.CSSProperties;
}

interface VSCodeRadioProps {
  value: string;
  children: React.ReactNode;
  disabled?: boolean;
  style?: React.CSSProperties;
}

// Mock VSCode components
jest.mock('@vscode/webview-ui-toolkit/react', () => ({
  VSCodeButton: function MockVSCodeButton({ 
    children,
    onClick,
    appearance,
    className 
  }: VSCodeButtonProps) {
    return (
      <button 
        onClick={onClick} 
        data-appearance={appearance}
        className={className}
      >
        {children}
      </button>
    )
  },
  VSCodeTextField: function MockVSCodeTextField({ 
    value,
    onInput,
    placeholder,
    style 
  }: VSCodeTextFieldProps) {
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => onInput?.({ target: { value: e.target.value } })}
        placeholder={placeholder}
        style={style}
      />
    )
  },
  VSCodeRadioGroup: function MockVSCodeRadioGroup({
    children,
    value,
    onChange,
    style
  }: VSCodeRadioGroupProps) {
    return (
      <div style={style} role="radiogroup" data-current-value={value}>
        {children}
      </div>
    )
  },
  VSCodeRadio: function MockVSCodeRadio({
    value,
    children,
    disabled,
    style
  }: VSCodeRadioProps) {
    return (
      <label style={style}>
        <input
          type="radio"
          value={value}
          disabled={disabled}
          data-testid={`radio-${value}`}
        />
        {children}
      </label>
    )
  }
}))

// Mock window.navigator.clipboard
Object.assign(navigator, {
  clipboard: {
    writeText: jest.fn(),
  },
})

// Mock window.postMessage to trigger state hydration
const mockPostMessage = (state: any) => {
  window.postMessage({
    type: 'state',
    state: {
      version: '1.0.0',
      taskHistory: [],
      ...state
    }
  }, '*')
}

describe('HistoryView', () => {
  const mockOnDone = jest.fn()
  const sampleHistory = [
    {
      id: '1',
      task: 'First task',
      ts: Date.now() - 3000,
      tokensIn: 100,
      tokensOut: 50,
      totalCost: 0.002
    },
    {
      id: '2',
      task: 'Second task',
      ts: Date.now() - 2000,
      tokensIn: 200,
      tokensOut: 100,
      totalCost: 0.004
    },
    {
      id: '3',
      task: 'Third task',
      ts: Date.now() - 1000,
      tokensIn: 300,
      tokensOut: 150,
      totalCost: 0.006
    }
  ]

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders history items in correct order', () => {
    render(
      <ExtensionStateContextProvider>
        <HistoryView onDone={mockOnDone} />
      </ExtensionStateContextProvider>
    )

    mockPostMessage({ taskHistory: sampleHistory })

    const historyItems = screen.getAllByText(/task/i)
    expect(historyItems).toHaveLength(3)
    expect(historyItems[0]).toHaveTextContent('Third task')
    expect(historyItems[1]).toHaveTextContent('Second task')
    expect(historyItems[2]).toHaveTextContent('First task')
  })

  it('handles sorting by different criteria', async () => {
    render(
      <ExtensionStateContextProvider>
        <HistoryView onDone={mockOnDone} />
      </ExtensionStateContextProvider>
    )

    mockPostMessage({ taskHistory: sampleHistory })

    // Test oldest sort
    const oldestRadio = screen.getByTestId('radio-oldest')
    fireEvent.click(oldestRadio)
    
    let historyItems = screen.getAllByText(/task/i)
    expect(historyItems[0]).toHaveTextContent('First task')
    expect(historyItems[2]).toHaveTextContent('Third task')

    // Test most expensive sort
    const expensiveRadio = screen.getByTestId('radio-mostExpensive')
    fireEvent.click(expensiveRadio)
    
    historyItems = screen.getAllByText(/task/i)
    expect(historyItems[0]).toHaveTextContent('Third task')
    expect(historyItems[2]).toHaveTextContent('First task')

    // Test most tokens sort
    const tokensRadio = screen.getByTestId('radio-mostTokens')
    fireEvent.click(tokensRadio)
    
    historyItems = screen.getAllByText(/task/i)
    expect(historyItems[0]).toHaveTextContent('Third task')
    expect(historyItems[2]).toHaveTextContent('First task')
  })

  it('handles search functionality and auto-switches to most relevant sort', async () => {
    render(
      <ExtensionStateContextProvider>
        <HistoryView onDone={mockOnDone} />
      </ExtensionStateContextProvider>
    )

    mockPostMessage({ taskHistory: sampleHistory })

    const searchInput = screen.getByPlaceholderText('Fuzzy search history...')
    fireEvent.change(searchInput, { target: { value: 'First' } })

    const historyItems = screen.getAllByText(/task/i)
    expect(historyItems).toHaveLength(1)
    expect(historyItems[0]).toHaveTextContent('First task')

    // Verify sort switched to Most Relevant
    const radioGroup = screen.getByRole('radiogroup')
    expect(radioGroup.getAttribute('data-current-value')).toBe('mostRelevant')

    // Clear search and verify sort reverts
    fireEvent.change(searchInput, { target: { value: '' } })
    expect(radioGroup.getAttribute('data-current-value')).toBe('newest')
  })

  it('handles copy functionality and shows/hides modal', async () => {
    render(
      <ExtensionStateContextProvider>
        <HistoryView onDone={mockOnDone} />
      </ExtensionStateContextProvider>
    )

    mockPostMessage({ taskHistory: sampleHistory })

    const copyButtons = screen.getAllByRole('button', { hidden: true })
      .filter(button => button.className.includes('copy-button'))
    
    fireEvent.click(copyButtons[0])

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Third task')
    
    // Verify modal appears
    await waitFor(() => {
      expect(screen.getByText('Prompt Copied to Clipboard')).toBeInTheDocument()
    })

    // Verify modal disappears
    await waitFor(() => {
      expect(screen.queryByText('Prompt Copied to Clipboard')).not.toBeInTheDocument()
    }, { timeout: 2500 })
  })

  it('handles delete functionality', () => {
    render(
      <ExtensionStateContextProvider>
        <HistoryView onDone={mockOnDone} />
      </ExtensionStateContextProvider>
    )

    mockPostMessage({ taskHistory: sampleHistory })

    const deleteButtons = screen.getAllByRole('button', { hidden: true })
      .filter(button => button.className.includes('delete-button'))
    
    fireEvent.click(deleteButtons[0])

    expect(vscode.postMessage).toHaveBeenCalledWith({
      type: 'deleteTaskWithId',
      text: '3'
    })
  })

  it('handles export functionality', () => {
    render(
      <ExtensionStateContextProvider>
        <HistoryView onDone={mockOnDone} />
      </ExtensionStateContextProvider>
    )

    mockPostMessage({ taskHistory: sampleHistory })

    const exportButtons = screen.getAllByRole('button', { hidden: true })
      .filter(button => button.className.includes('export-button'))
    
    fireEvent.click(exportButtons[0])

    expect(vscode.postMessage).toHaveBeenCalledWith({
      type: 'exportTaskWithId',
      text: '3'
    })
  })

  it('calls onDone when Done button is clicked', () => {
    render(
      <ExtensionStateContextProvider>
        <HistoryView onDone={mockOnDone} />
      </ExtensionStateContextProvider>
    )

    const doneButton = screen.getByText('Done')
    fireEvent.click(doneButton)

    expect(mockOnDone).toHaveBeenCalled()
  })

  describe('highlight function', () => {
    it('correctly highlights search matches', () => {
      const testData = [{
        item: { text: 'Hello world' },
        matches: [{ key: 'text', value: 'Hello world', indices: [[0, 4]] }],
        refIndex: 0
      }] as FuseResult<any>[]

      const result = highlight(testData)
      expect(result[0].text).toBe('<span class="history-item-highlight">Hello</span> world')
    })

    it('handles multiple matches', () => {
      const testData = [{
        item: { text: 'Hello world Hello' },
        matches: [{ 
          key: 'text', 
          value: 'Hello world Hello', 
          indices: [[0, 4], [11, 15]] 
        }],
        refIndex: 0
      }] as FuseResult<any>[]

      const result = highlight(testData)
      expect(result[0].text).toBe(
        '<span class="history-item-highlight">Hello</span> world ' +
        '<span class="history-item-highlight">Hello</span>'
      )
    })

    it('handles overlapping matches', () => {
      const testData = [{
        item: { text: 'Hello' },
        matches: [{ 
          key: 'text', 
          value: 'Hello', 
          indices: [[0, 2], [1, 4]] 
        }],
        refIndex: 0
      }] as FuseResult<any>[]

      const result = highlight(testData)
      expect(result[0].text).toBe('<span class="history-item-highlight">Hello</span>')
    })
  })
})
