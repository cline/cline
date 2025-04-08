import { VSCodeButton, VSCodeDivider } from '@vscode/webview-ui-toolkit/react'
import { useEffect, useState } from 'react'
import { useExtensionState } from '../../context/ExtensionStateContext'
import { validateApiConfiguration } from '../../utils/validate'
import { vscode } from '../../utils/vscode'
import ApiOptions from '../settings/ApiOptions'
import PostHogLogoWhite from '../../assets/PostHogLogoWhite'
import AutocompleteOptions from '../settings/AutocompleteOptions'
import PostHogConfigOptions from '../settings/PostHogConfigOptions'

const WelcomeView = () => {
    const { apiConfiguration, setApiConfiguration } = useExtensionState()
    const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(undefined)
    const [showApiOptions, setShowApiOptions] = useState(false)

    const disableLetsGoButton = apiErrorMessage != null

    const handleSubmit = () => {
        setApiConfiguration({
            ...apiConfiguration,
            apiKey: 'test',
        })
    }

    useEffect(() => {
        setApiErrorMessage(validateApiConfiguration(apiConfiguration))
    }, [apiConfiguration])

    const hasPersonalApiKey = !!apiConfiguration?.posthogPersonalApiKey

    return (
        <div
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                padding: '0 0px',
                display: 'flex',
                flexDirection: 'column',
            }}
        >
            <div
                style={{
                    height: '100%',
                    padding: '0 20px',
                    overflow: 'auto',
                }}
            >
                <h2>Hi, I'm PostHog</h2>
                <div style={{ display: 'flex', justifyContent: 'center', margin: '20px 0' }}>
                    <PostHogLogoWhite className="size-16" />
                </div>
                <p>I'm here to help you build a successful product.</p>
                <p>I can help you write code and respond to questions about your product and users.</p>
                <p>Let's get started.</p>
                <VSCodeDivider style={{ margin: '20px 0' }} />

                {!hasPersonalApiKey && <PostHogConfigOptions />}

                {hasPersonalApiKey && (
                    <>
                        <VSCodeButton
                            onClick={() => {
                                setApiConfiguration({
                                    ...apiConfiguration,
                                    apiKey: 'test',
                                })
                            }}
                        >
                            Use test API key
                        </VSCodeButton>

                        {!showApiOptions && (
                            <VSCodeButton
                                appearance="secondary"
                                onClick={() => setShowApiOptions(!showApiOptions)}
                                style={{ marginTop: 10, width: '100%' }}
                            >
                                Use your own API key
                            </VSCodeButton>
                        )}

                        <div style={{ marginTop: '18px' }}>
                            {showApiOptions && (
                                <div>
                                    <ApiOptions showModelOptions={false} />
                                    <AutocompleteOptions />
                                    <VSCodeButton
                                        onClick={handleSubmit}
                                        disabled={disableLetsGoButton}
                                        style={{ marginTop: '3px' }}
                                    >
                                        Let's go!
                                    </VSCodeButton>
                                    {apiErrorMessage && (
                                        <p style={{ color: 'var(--vscode-errorForeground)' }}>{apiErrorMessage}</p>
                                    )}
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}

export default WelcomeView
