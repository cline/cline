import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useEvent } from 'react-use'
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from '../../../src/shared/AutoApprovalSettings'
import { ExtensionMessage, ExtensionState, DEFAULT_PLATFORM } from '../../../src/shared/ExtensionMessage'
import { ApiConfiguration } from '../../../src/shared/api'
import { findLastIndex } from '../../../src/shared/array'
import { McpServer } from '../../../src/shared/mcp'
import { convertTextMateToHljs } from '../utils/textMateToHljs'
import { vscode } from '../utils/vscode'
import { DEFAULT_BROWSER_SETTINGS } from '../../../src/shared/BrowserSettings'
import { DEFAULT_CHAT_SETTINGS } from '../../../src/shared/ChatSettings'
import { TelemetrySetting } from '../../../src/shared/TelemetrySetting'

interface ExtensionStateContextType extends ExtensionState {
    didHydrateState: boolean
    showWelcome: boolean
    theme: any
    mcpServers: McpServer[]
    filePaths: string[]
    totalTasksSize: number | null
    setApiConfiguration: (config: ApiConfiguration) => void
    setCustomInstructions: (value?: string) => void
    setTelemetrySetting: (value: TelemetrySetting) => void
    setPlanActSeparateModelsSetting: (value: boolean) => void
    setEnableTabAutocomplete: (value: boolean) => void
}

const ExtensionStateContext = createContext<ExtensionStateContextType | undefined>(undefined)

export const ExtensionStateContextProvider: React.FC<{
    children: React.ReactNode
}> = ({ children }) => {
    const [state, setState] = useState<ExtensionState>({
        version: '',
        posthogMessages: [],
        taskHistory: [],
        autoApprovalSettings: DEFAULT_AUTO_APPROVAL_SETTINGS,
        browserSettings: DEFAULT_BROWSER_SETTINGS,
        chatSettings: DEFAULT_CHAT_SETTINGS,
        platform: DEFAULT_PLATFORM,
        telemetrySetting: 'unset',
        vscMachineId: '',
        planActSeparateModelsSetting: true,
        enableTabAutocomplete: true,
    })
    const [didHydrateState, setDidHydrateState] = useState(false)
    const [showWelcome, setShowWelcome] = useState(false)
    const [theme, setTheme] = useState<any>(undefined)
    const [filePaths, setFilePaths] = useState<string[]>([])
    const [totalTasksSize, setTotalTasksSize] = useState<number | null>(null)

    const [mcpServers, setMcpServers] = useState<McpServer[]>([])
    const handleMessage = useCallback((event: MessageEvent) => {
        const message: ExtensionMessage = event.data
        switch (message.type) {
            case 'state': {
                console.log('state', message.state)
                setState(message.state!)
                const config = message.state?.apiConfiguration
                const hasKey = config ? config.posthogApiKey : false
                setShowWelcome(!hasKey)
                setDidHydrateState(true)
                break
            }
            case 'theme': {
                if (message.text) {
                    setTheme(convertTextMateToHljs(JSON.parse(message.text)))
                }
                break
            }
            case 'workspaceUpdated': {
                setFilePaths(message.filePaths ?? [])
                break
            }
            case 'partialMessage': {
                const partialMessage = message.partialMessage!
                setState((prevState) => {
                    // worth noting it will never be possible for a more up-to-date message to be sent here or in normal messages post since the presentAssistantContent function uses lock
                    const lastIndex = findLastIndex(prevState.posthogMessages, (msg) => msg.ts === partialMessage.ts)
                    if (lastIndex !== -1) {
                        const newPostHogMessages = [...prevState.posthogMessages]
                        newPostHogMessages[lastIndex] = partialMessage
                        return { ...prevState, posthogMessages: newPostHogMessages }
                    }
                    return prevState
                })
                break
            }
            case 'mcpServers': {
                setMcpServers(message.mcpServers ?? [])
                break
            }
            case 'totalTasksSize': {
                setTotalTasksSize(message.totalTasksSize ?? null)
                break
            }
        }
    }, [])

    useEvent('message', handleMessage)

    useEffect(() => {
        vscode.postMessage({ type: 'webviewDidLaunch' })
    }, [])

    const contextValue: ExtensionStateContextType = {
        ...state,
        didHydrateState,
        showWelcome,
        theme,
        mcpServers,
        filePaths,
        totalTasksSize,
        setApiConfiguration: (value) => {
            setState((prevState) => ({
                ...prevState,
                apiConfiguration: value,
            }))
            vscode.postMessage({
                type: 'updateSettings',
                apiConfiguration: value,
            })
        },
        setCustomInstructions: (value) => {
            setState((prevState) => ({
                ...prevState,
                customInstructions: value,
            }))
            vscode.postMessage({
                type: 'updateSettings',
                customInstructionsSetting: value,
            })
        },
        setTelemetrySetting: (value) => {
            setState((prevState) => ({
                ...prevState,
                telemetrySetting: value,
            }))
            vscode.postMessage({
                type: 'updateSettings',
                telemetrySetting: value,
            })
        },
        setPlanActSeparateModelsSetting: (value) => {
            setState((prevState) => ({
                ...prevState,
                planActSeparateModelsSetting: value,
            }))
            vscode.postMessage({
                type: 'updateSettings',
                planActSeparateModelsSetting: value,
            })
        },
        setEnableTabAutocomplete: (value) => {
            console.log('setEnableTabAutocomplete', value)
            setState((prevState) => ({
                ...prevState,
                enableTabAutocomplete: value,
            }))
            vscode.postMessage({
                type: 'updateSettings',
                enableTabAutocomplete: value,
            })
        },
    }

    return <ExtensionStateContext.Provider value={contextValue}>{children}</ExtensionStateContext.Provider>
}

export const useExtensionState = () => {
    const context = useContext(ExtensionStateContext)
    if (context === undefined) {
        throw new Error('useExtensionState must be used within an ExtensionStateContextProvider')
    }
    return context
}
