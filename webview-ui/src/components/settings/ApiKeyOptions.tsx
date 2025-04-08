import { VSCodeButton, VSCodeTextField } from '@vscode/webview-ui-toolkit/react'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { ApiConfiguration } from '../../../../src/shared/api'
import { useExtensionState } from '../../context/ExtensionStateContext'
import { debounce } from 'lodash'

interface ApiOptionsProps {
    apiErrorMessage?: string
    autoSave?: boolean
}

const ApiKeyOptions = memo(
    ({ apiErrorMessage, autoSave = true }: ApiOptionsProps) => {
        const { apiConfiguration, setApiConfiguration } = useExtensionState()
        const [localState, setLocalState] = useState<ApiConfiguration>(apiConfiguration || {})

        // Only update local state when apiConfiguration actually changes
        useEffect(() => {
            if (JSON.stringify(apiConfiguration) !== JSON.stringify(localState)) {
                setLocalState(apiConfiguration || {})
            }
        }, [apiConfiguration])

        // Memoize the debounced function to prevent recreation on every render
        const debouncedSetApiConfiguration = useMemo(
            () =>
                debounce((newConfig: ApiConfiguration) => {
                    setApiConfiguration(newConfig)
                }, 500),
            [setApiConfiguration]
        )

        // Memoize the input change handler
        const handleInputChange = useCallback(
            (field: keyof ApiConfiguration) => (event: any) => {
                const newValue = event.target.value
                setLocalState((prev) => {
                    const newState = {
                        ...prev,
                        [field]: newValue,
                    }
                    if (autoSave) {
                        debouncedSetApiConfiguration(newState)
                    }
                    return newState
                })
            },
            [debouncedSetApiConfiguration, autoSave]
        )

        const handleSubmit = () => {
            debouncedSetApiConfiguration(localState)
        }

        const disableLetsGoButton = apiErrorMessage != null

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <VSCodeTextField
                    value={localState?.posthogApiKey || ''}
                    style={{ width: '100%' }}
                    type="password"
                    onInput={handleInputChange('posthogApiKey')}
                    placeholder="Enter PostHog Personal API Key..."
                >
                    <span style={{ fontWeight: 500 }}>PostHog Personal API Key</span>
                </VSCodeTextField>
                {apiErrorMessage && (
                    <p
                        style={{
                            margin: '-10px 0 4px 0',
                            fontSize: 12,
                            color: 'var(--vscode-errorForeground)',
                        }}
                    >
                        {apiErrorMessage}
                    </p>
                )}
                {!autoSave && (
                    <VSCodeButton onClick={handleSubmit} disabled={disableLetsGoButton} style={{ marginTop: '10px' }}>
                        Let's go!
                    </VSCodeButton>
                )}
            </div>
        )
    },
    (prevProps, nextProps) => {
        // Custom comparison function for memo
        return prevProps.apiErrorMessage === nextProps.apiErrorMessage
    }
)

export default ApiKeyOptions
