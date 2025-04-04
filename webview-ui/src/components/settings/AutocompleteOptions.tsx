import { VSCodeCheckbox, VSCodeTextField } from '@vscode/webview-ui-toolkit/react'
import { memo } from 'react'
import { ApiConfiguration } from '../../../../src/shared/api'
import { useExtensionState } from '../../context/ExtensionStateContext'

declare module 'vscode' {
    interface LanguageModelChatSelector {
        vendor?: string
        family?: string
        version?: string
        id?: string
    }
}

const AutocompleteOptions = () => {
    const { apiConfiguration, setApiConfiguration, enableTabAutocomplete, setEnableTabAutocomplete } =
        useExtensionState()

    const handleInputChange = (field: keyof ApiConfiguration) => (event: any) => {
        setApiConfiguration({
            ...apiConfiguration,
            [field]: event.target.value,
        })
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 0 }}>
            <div>
                <VSCodeCheckbox
                    style={{ marginBottom: '10px' }}
                    checked={enableTabAutocomplete}
                    onChange={(e: any) => {
                        const checked = e.target.checked === true
                        setEnableTabAutocomplete(checked)
                    }}
                >
                    Enable tab auto-complete
                </VSCodeCheckbox>
            </div>
            <div>
                <VSCodeTextField
                    value={apiConfiguration?.codestralApiKey || ''}
                    style={{ width: '100%' }}
                    type="password"
                    onInput={handleInputChange('codestralApiKey')}
                    placeholder="Enter Codestral API Key..."
                >
                    <span style={{ fontWeight: 500 }}>Auto-complete API Key</span>
                </VSCodeTextField>
                <p
                    style={{
                        fontSize: '12px',
                        marginTop: 3,
                        color: 'var(--vscode-descriptionForeground)',
                    }}
                >
                    This key is stored locally and only used to make API requests from this extension.
                </p>
            </div>
        </div>
    )
}

export default memo(AutocompleteOptions)
