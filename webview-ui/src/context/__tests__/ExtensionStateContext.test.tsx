import React from 'react'
import { render, screen, act } from '@testing-library/react'
import { ExtensionStateContextProvider, useExtensionState } from '../ExtensionStateContext'

// Test component that consumes the context
const TestComponent = () => {
  const { allowedCommands, setAllowedCommands } = useExtensionState()
  return (
    <div>
      <div data-testid="allowed-commands">{JSON.stringify(allowedCommands)}</div>
      <button
        data-testid="update-button"
        onClick={() => setAllowedCommands(['npm install', 'git status'])}
      >
        Update Commands
      </button>
    </div>
  )
}

describe('ExtensionStateContext', () => {
  it('initializes with empty allowedCommands array', () => {
    render(
      <ExtensionStateContextProvider>
        <TestComponent />
      </ExtensionStateContextProvider>
    )

    expect(JSON.parse(screen.getByTestId('allowed-commands').textContent!)).toEqual([])
  })

  it('updates allowedCommands through setAllowedCommands', () => {
    render(
      <ExtensionStateContextProvider>
        <TestComponent />
      </ExtensionStateContextProvider>
    )

    act(() => {
      screen.getByTestId('update-button').click()
    })

    expect(JSON.parse(screen.getByTestId('allowed-commands').textContent!)).toEqual([
      'npm install',
      'git status'
    ])
  })

  it('throws error when used outside provider', () => {
    // Suppress console.error for this test since we expect an error
    const consoleSpy = jest.spyOn(console, 'error')
    consoleSpy.mockImplementation(() => {})

    expect(() => {
      render(<TestComponent />)
    }).toThrow('useExtensionState must be used within an ExtensionStateContextProvider')

    consoleSpy.mockRestore()
  })
})
