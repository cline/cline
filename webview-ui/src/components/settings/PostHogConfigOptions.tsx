import { VSCodeButton, VSCodeTextField, VSCodeRadioGroup, VSCodeRadio } from '@vscode/webview-ui-toolkit/react'
import { memo, useState } from 'react'
import { ApiConfiguration } from '../../../../src/shared/api'
import { useExtensionState } from '../../context/ExtensionStateContext'
import VSCodeButtonLink from '../common/VSCodeButtonLink'

const PostHogConfigOptions = () => {
    const [personalApiKey, setPersonalApiKey] = useState('')
    const [cloud, setCloud] = useState<'us' | 'eu'>('us')
    const { apiConfiguration, setApiConfiguration } = useExtensionState()

    const handleSubmit = () => {
        setApiConfiguration({
            ...apiConfiguration,
            posthogPersonalApiKey: personalApiKey,
            posthogHost: cloud === 'us' ? 'https://us.posthog.com' : 'https://eu.posthog.com',
        })
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 0 }}>
            <div>
                <VSCodeTextField
                    value={personalApiKey}
                    style={{ width: '100%' }}
                    type="password"
                    onInput={(e: any) => setPersonalApiKey(e.target?.value)}
                    placeholder="Enter PostHog personal API key..."
                >
                    <span style={{ fontWeight: 500, marginBottom: 5 }}>PostHog personal API key</span>
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
                <VSCodeRadioGroup
                    value={cloud}
                    onChange={(e: any) => setCloud(e.target.value)}
                    style={{ marginTop: 10 }}
                >
                    <VSCodeRadio value="us">US Cloud</VSCodeRadio>
                    <VSCodeRadio value="eu">EU Cloud</VSCodeRadio>
                </VSCodeRadioGroup>
                {personalApiKey ? (
                    <VSCodeButton onClick={handleSubmit} style={{ marginTop: 10, width: '100%' }}>
                        Save
                    </VSCodeButton>
                ) : (
                    <VSCodeButtonLink
                        href="https://app.posthog.com/settings/user-api-keys?preset=zapier"
                        style={{ marginTop: 10, width: '100%' }}
                    >
                        Create a PostHog personal API key
                    </VSCodeButtonLink>
                )}
            </div>
        </div>
    )
}

export default memo(PostHogConfigOptions)
