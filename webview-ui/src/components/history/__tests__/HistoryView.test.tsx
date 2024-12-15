import React from 'react'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HistoryView from '../HistoryView'
import { useExtensionState } from '../../../context/ExtensionStateContext'
import { vscode } from '../../../utils/vscode'

// Mock dependencies
jest.mock('../../../context/ExtensionStateContext')
jest.mock('../../../utils/vscode')
jest.mock('react-virtuoso', () => ({
  Virtuoso: ({ data, itemContent }: any) => (
    <div data-testid="virtuoso-container">
      {data.map((item: any, index: number) => (
        <div key={item.id} data-testid={`virtuoso-item-${item.id}`}>
          {itemContent(index, item)}
        </div>
      ))}
    </div>
  ),
}))

const mockTaskHistory = [
  {
    id: '1',
    task: 'Test task 1',
    ts: new Date('2022-02-16T00:00:00').getTime(),
    tokensIn: 100,
    tokensOut: 50,
    totalCost: 0.002,
  },
  {
    id: '2',
    task: 'Test task 2',
    ts: new Date('2022-02-17T00:00:00').getTime(),
    tokensIn: 200,
    tokensOut: 100,
    cacheWrites: 50,
    cacheReads: 25,
  },
]

describe('HistoryView', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks()
    jest.useFakeTimers()
    
    // Mock useExtensionState implementation
    ;(useExtensionState as jest.Mock).mockReturnValue({
      taskHistory: mockTaskHistory,
    })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('renders history items correctly', () => {
    const onDone = jest.fn()
    render(<HistoryView onDone={onDone} />)

    // Check if both tasks are rendered
    expect(screen.getByTestId('virtuoso-item-1')).toBeInTheDocument()
    expect(screen.getByTestId('virtuoso-item-2')).toBeInTheDocument()
    expect(screen.getByText('Test task 1')).toBeInTheDocument()
    expect(screen.getByText('Test task 2')).toBeInTheDocument()
  })

  it('handles search functionality', async () => {
    const onDone = jest.fn()
    render(<HistoryView onDone={onDone} />)

    // Get search input and radio group
    const searchInput = screen.getByPlaceholderText('Fuzzy search history...')
    const radioGroup = screen.getByRole('radiogroup')
    
    // Type in search
    await userEvent.type(searchInput, 'task 1')

    // Check if sort option automatically changes to "Most Relevant"
    const mostRelevantRadio = within(radioGroup).getByLabelText('Most Relevant')
    expect(mostRelevantRadio).not.toBeDisabled()
    
    // Click and wait for radio update
    fireEvent.click(mostRelevantRadio)

    // Wait for radio button to be checked
    const updatedRadio = await within(radioGroup).findByRole('radio', { name: 'Most Relevant', checked: true })
    expect(updatedRadio).toBeInTheDocument()
  })

  it('handles sort options correctly', async () => {
    const onDone = jest.fn()
    render(<HistoryView onDone={onDone} />)

    const radioGroup = screen.getByRole('radiogroup')

    // Test changing sort options
    const oldestRadio = within(radioGroup).getByLabelText('Oldest')
    fireEvent.click(oldestRadio)
    
    // Wait for oldest radio to be checked
    const checkedOldestRadio = await within(radioGroup).findByRole('radio', { name: 'Oldest', checked: true })
    expect(checkedOldestRadio).toBeInTheDocument()

    const mostExpensiveRadio = within(radioGroup).getByLabelText('Most Expensive')
    fireEvent.click(mostExpensiveRadio)
    
    // Wait for most expensive radio to be checked
    const checkedExpensiveRadio = await within(radioGroup).findByRole('radio', { name: 'Most Expensive', checked: true })
    expect(checkedExpensiveRadio).toBeInTheDocument()
  })

  it('handles task selection', () => {
    const onDone = jest.fn()
    render(<HistoryView onDone={onDone} />)

    // Click on first task
    fireEvent.click(screen.getByText('Test task 1'))

    // Verify vscode message was sent
    expect(vscode.postMessage).toHaveBeenCalledWith({
      type: 'showTaskWithId',
      text: '1',
    })
  })

  it('handles task deletion', () => {
    const onDone = jest.fn()
    render(<HistoryView onDone={onDone} />)

    // Find and hover over first task
    const taskContainer = screen.getByTestId('virtuoso-item-1')
    fireEvent.mouseEnter(taskContainer)
    
    const deleteButton = within(taskContainer).getByTitle('Delete Task')
    fireEvent.click(deleteButton)

    // Verify vscode message was sent
    expect(vscode.postMessage).toHaveBeenCalledWith({
      type: 'deleteTaskWithId',
      text: '1',
    })
  })

  it('handles task copying', async () => {
    const mockClipboard = {
      writeText: jest.fn().mockResolvedValue(undefined),
    }
    Object.assign(navigator, { clipboard: mockClipboard })

    const onDone = jest.fn()
    render(<HistoryView onDone={onDone} />)

    // Find and hover over first task
    const taskContainer = screen.getByTestId('virtuoso-item-1')
    fireEvent.mouseEnter(taskContainer)
    
    const copyButton = within(taskContainer).getByTitle('Copy Prompt')
    await userEvent.click(copyButton)

    // Verify clipboard API was called
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Test task 1')
    
    // Wait for copy modal to appear
    const copyModal = await screen.findByText('Prompt Copied to Clipboard')
    expect(copyModal).toBeInTheDocument()

    // Fast-forward timers and wait for modal to disappear
    jest.advanceTimersByTime(2000)
    await waitFor(() => {
      expect(screen.queryByText('Prompt Copied to Clipboard')).not.toBeInTheDocument()
    })
  })

  it('formats dates correctly', () => {
    const onDone = jest.fn()
    render(<HistoryView onDone={onDone} />)

    // Find first task container and check date format
    const taskContainer = screen.getByTestId('virtuoso-item-1')
    const dateElement = within(taskContainer).getByText((content) => {
      return content.includes('FEBRUARY 16') && content.includes('12:00 AM')
    })
    expect(dateElement).toBeInTheDocument()
  })

  it('displays token counts correctly', () => {
    const onDone = jest.fn()
    render(<HistoryView onDone={onDone} />)

    // Find first task container
    const taskContainer = screen.getByTestId('virtuoso-item-1')

    // Find token counts within the task container
    const tokensContainer = within(taskContainer).getByTestId('tokens-container')
    expect(within(tokensContainer).getByTestId('tokens-in')).toHaveTextContent('100')
    expect(within(tokensContainer).getByTestId('tokens-out')).toHaveTextContent('50')
  })

  it('displays cache information when available', () => {
    const onDone = jest.fn()
    render(<HistoryView onDone={onDone} />)

    // Find second task container
    const taskContainer = screen.getByTestId('virtuoso-item-2')

    // Find cache info within the task container
    const cacheContainer = within(taskContainer).getByTestId('cache-container')
    expect(within(cacheContainer).getByTestId('cache-writes')).toHaveTextContent('+50')
    expect(within(cacheContainer).getByTestId('cache-reads')).toHaveTextContent('25')
  })

  it('handles export functionality', () => {
    const onDone = jest.fn()
    render(<HistoryView onDone={onDone} />)

    // Find and hover over second task
    const taskContainer = screen.getByTestId('virtuoso-item-2')
    fireEvent.mouseEnter(taskContainer)
    
    const exportButton = within(taskContainer).getByText('EXPORT')
    fireEvent.click(exportButton)

    // Verify vscode message was sent
    expect(vscode.postMessage).toHaveBeenCalledWith({
      type: 'exportTaskWithId',
      text: '2',
    })
  })
})