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
    const { enableTabAutocomplete, setEnableTabAutocomplete } = useExtensionState()

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
        </div>
    )
}

export default memo(AutocompleteOptions)
