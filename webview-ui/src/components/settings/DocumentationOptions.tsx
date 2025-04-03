import { VSCodeTextField } from '@vscode/webview-ui-toolkit/react'
import { memo } from 'react'
import { ApiConfiguration } from '../../../../src/shared/api'
import { useExtensionState } from '../../context/ExtensionStateContext'

const DocumentationOptions = () => {
    const { apiConfiguration, setApiConfiguration } = useExtensionState()

    const handleInputChange = (field: keyof ApiConfiguration) => (event: any) => {
        setApiConfiguration({
            ...apiConfiguration,
            [field]: event.target.value,
        })
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 0 }}>
            <div>
                <VSCodeTextField
                    value={apiConfiguration?.inkeepApiKey || ''}
                    style={{ width: '100%' }}
                    type="password"
                    onInput={handleInputChange('inkeepApiKey')}
                    placeholder="Enter Inkeep API Key..."
                >
                    <span style={{ fontWeight: 500 }}>Inkeep API Key</span>
                </VSCodeTextField>
                <p
                    style={{
                        fontSize: '12px',
                        marginTop: 3,
                        color: 'var(--vscode-descriptionForeground)',
                    }}
                >
                    API key for documentation search. Securely stored locally and used to make search docs requests.
                </p>
            </div>
        </div>
    )
}

export default memo(DocumentationOptions)
