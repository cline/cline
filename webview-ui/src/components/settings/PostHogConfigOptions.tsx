import { VSCodeButton, VSCodeTextField, VSCodeRadioGroup, VSCodeRadio } from '@vscode/webview-ui-toolkit/react'
import { memo, useEffect, useState } from 'react'
import { useExtensionState } from '../../context/ExtensionStateContext'
import VSCodeButtonLink from '../common/VSCodeButtonLink'

const PostHogConfigOptions = () => {
    const { apiConfiguration, setApiConfiguration } = useExtensionState()
    const [personalApiKey, setPersonalApiKey] = useState(apiConfiguration?.posthogApiKey)
    const [cloud, setCloud] = useState<'us' | 'eu'>(
        apiConfiguration?.posthogHost === 'https://eu.posthog.com' ? 'eu' : 'us'
    )

    useEffect(() => {
        setPersonalApiKey(apiConfiguration?.posthogApiKey)
        setCloud(apiConfiguration?.posthogHost === 'https://eu.posthog.com' ? 'eu' : 'us')
    }, [apiConfiguration])

    const handleSubmit = () => {
        setApiConfiguration({
            ...apiConfiguration,
            posthogApiKey: personalApiKey,
            posthogHost: cloud === 'us' ? 'https://us.posthog.com' : 'https://eu.posthog.com',
        })
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 0 }}>
            <div>
                <div style={{ display: 'flex', gap: 5 }}>
                    <VSCodeTextField
                        value={personalApiKey}
                        style={{ width: '100%' }}
                        type="password"
                        onInput={(e: any) => setPersonalApiKey(e.target?.value)}
                        placeholder="Enter PostHog personal API key..."
                    >
                        <span style={{ fontWeight: 500, marginBottom: 5 }}>PostHog personal API key</span>
                    </VSCodeTextField>
                    {personalApiKey && (
                        <VSCodeButton onClick={handleSubmit} style={{ marginTop: 17 }}>
                            Save
                        </VSCodeButton>
                    )}
                </div>
                <p
                    style={{
                        fontSize: '12px',
                        marginTop: 3,
                        color: 'var(--vscode-descriptionForeground)',
                    }}
                >
                    This key is stored locally and only used to make API requests from this extension.{' '}
                </p>
                <VSCodeRadioGroup
                    value={cloud}
                    onChange={(e: any) => setCloud(e.target.value)}
                    style={{ marginTop: 10 }}
                >
                    <VSCodeRadio value="us">US Cloud</VSCodeRadio>
                    <VSCodeRadio value="eu">EU Cloud</VSCodeRadio>
                </VSCodeRadioGroup>
                {!personalApiKey && (
                    <VSCodeButtonLink
                        href="https://app.posthog.com/settings/user-api-keys?preset=editor"
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
