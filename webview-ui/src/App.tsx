import { useCallback, useEffect, useState } from 'react'
import { useEvent } from 'react-use'
import { ExtensionMessage } from '../../src/shared/ExtensionMessage'
import ChatView from './components/chat/ChatView'
import HistoryView from './components/history/HistoryView'
import SettingsView from './components/settings/SettingsView'
import { ExtensionStateContextProvider, useExtensionState } from './context/ExtensionStateContext'
import McpView from './components/mcp/McpView'
import { AnalysisView } from './components/analysis/AnalysisView'

const AppContent = () => {
    const { didHydrateState } = useExtensionState()
    const [showSettings, setShowSettings] = useState(false)
    const [showHistory, setShowHistory] = useState(false)
    const [showAnalysis, setShowAnalysis] = useState(false)
    const [showMcp, setShowMcp] = useState(false)

    const handleMessage = useCallback((e: MessageEvent) => {
        const message: ExtensionMessage = e.data
        switch (message.type) {
            case 'action':
                switch (message.action!) {
                    case 'settingsButtonClicked':
                        setShowSettings(true)
                        setShowHistory(false)
                        setShowMcp(false)
                        setShowAnalysis(false)
                        break
                    case 'historyButtonClicked':
                        setShowSettings(false)
                        setShowHistory(true)
                        setShowMcp(false)
                        setShowAnalysis(false)
                        break
                    case 'mcpButtonClicked':
                        setShowSettings(false)
                        setShowHistory(false)
                        setShowMcp(true)
                        setShowAnalysis(false)
                        break
                    case 'chatButtonClicked':
                        setShowSettings(false)
                        setShowHistory(false)
                        setShowMcp(false)
                        setShowAnalysis(false)
                        break
                    case 'analysisButtonClicked':
                        setShowSettings(false)
                        setShowHistory(false)
                        setShowMcp(false)
                        setShowAnalysis(true)
                        break
                }
                break
        }
    }, [])

    useEvent('message', handleMessage)

    if (!didHydrateState) {
        return null
    }

    return (
        <>
            {showSettings && <SettingsView />}
            {showHistory && <HistoryView onDone={() => setShowHistory(false)} />}
            {showMcp && <McpView onDone={() => setShowMcp(false)} />}
            {showAnalysis && <AnalysisView onDone={() => setShowAnalysis(false)} />}
            {/* Do not conditionally load ChatView, it's expensive and there's state we don't want to lose (user input, disableInput, askResponse promise, etc.) */}
            <ChatView
                showHistoryView={() => {
                    setShowSettings(false)
                    setShowMcp(false)
                    setShowHistory(true)
                    setShowAnalysis(false)
                }}
                isHidden={showSettings || showHistory || showMcp || showAnalysis}
            />
        </>
    )
}

const App = () => {
    return (
        <ExtensionStateContextProvider>
            <AppContent />
        </ExtensionStateContextProvider>
    )
}

export default App
