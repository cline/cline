import { VSCodeCheckbox, VSCodeTextField } from '@vscode/webview-ui-toolkit/react'
import { useCallback } from 'react'
import styled from 'styled-components'
import { useExtensionState } from '../../context/ExtensionStateContext'
import { AutoApprovalSettings } from '../../../../src/shared/AutoApprovalSettings'
import { vscode } from '../../utils/vscode'
import {
    getAsVar,
    VSC_FOREGROUND,
    VSC_TITLEBAR_INACTIVE_FOREGROUND,
    VSC_DESCRIPTION_FOREGROUND,
} from '../../utils/vscStyles'

interface AutoApproveMenuProps {
    style?: React.CSSProperties
}

const ACTION_METADATA: {
    id: keyof AutoApprovalSettings['actions']
    label: string
    shortName: string
    description: string
}[] = [
    {
        id: 'readFiles',
        label: 'Read files and directories',
        shortName: 'Read',
        description: 'Allows access to read any file on your computer.',
    },
    {
        id: 'editFiles',
        label: 'Edit files',
        shortName: 'Edit',
        description: 'Allows modification of any files on your computer.',
    },
    {
        id: 'executeCommands',
        label: 'Execute safe commands',
        shortName: 'Commands',
        description:
            'Allows execution of safe terminal commands. If the model determines a command is potentially destructive, it will still require approval.',
    },
    {
        id: 'useBrowser',
        label: 'Use the browser',
        shortName: 'Browser',
        description: 'Allows ability to launch and interact with any website in a headless browser.',
    },
    {
        id: 'useMcp',
        label: 'Use MCP servers',
        shortName: 'MCP',
        description: 'Allows use of configured MCP servers which may modify filesystem or interact with APIs.',
    },
]

const AutoApproveMenu = ({ style }: AutoApproveMenuProps) => {
    const { autoApprovalSettings } = useExtensionState()

    const updateAction = useCallback(
        (actionId: keyof AutoApprovalSettings['actions'], value: boolean) => {
            const newActions = {
                ...autoApprovalSettings.actions,
                [actionId]: value,
            }

            vscode.postMessage({
                type: 'autoApprovalSettings',
                autoApprovalSettings: {
                    ...autoApprovalSettings,
                    actions: newActions,
                },
            })
        },
        [autoApprovalSettings]
    )

    const updateMaxRequests = useCallback(
        (maxRequests: number) => {
            vscode.postMessage({
                type: 'autoApprovalSettings',
                autoApprovalSettings: {
                    ...autoApprovalSettings,
                    maxRequests,
                },
            })
        },
        [autoApprovalSettings]
    )

    const updateNotifications = useCallback(
        (enableNotifications: boolean) => {
            vscode.postMessage({
                type: 'autoApprovalSettings',
                autoApprovalSettings: {
                    ...autoApprovalSettings,
                    enableNotifications,
                },
            })
        },
        [autoApprovalSettings]
    )

    return (
        <div
            style={{
                userSelect: 'none',
                borderTop: `0.5px solid color-mix(in srgb, ${getAsVar(VSC_TITLEBAR_INACTIVE_FOREGROUND)} 20%, transparent)`,
                padding: '10px 0',
                ...style,
            }}
        >
            <div style={{ padding: '0' }}>
                <div
                    style={{
                        marginBottom: '10px',
                        color: getAsVar(VSC_DESCRIPTION_FOREGROUND),
                        fontSize: '12px',
                    }}
                >
                    Auto-approve allows PostHog to perform the following actions without asking for permission. Please
                    use with caution and only enable if you understand the risks.
                </div>
                {ACTION_METADATA.map((action) => (
                    <div key={action.id} style={{ margin: '6px 0' }}>
                        <VSCodeCheckbox
                            checked={autoApprovalSettings.actions[action.id]}
                            onChange={(e) => {
                                const checked = (e.target as HTMLInputElement).checked
                                updateAction(action.id, checked)
                            }}
                        >
                            {action.label}
                        </VSCodeCheckbox>
                        <div
                            style={{
                                marginLeft: '28px',
                                color: getAsVar(VSC_DESCRIPTION_FOREGROUND),
                                fontSize: '12px',
                            }}
                        >
                            {action.description}
                        </div>
                    </div>
                ))}
                <div
                    style={{
                        height: '0.5px',
                        background: getAsVar(VSC_TITLEBAR_INACTIVE_FOREGROUND),
                        margin: '15px 0',
                        opacity: 0.2,
                    }}
                />
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginTop: '10px',
                        marginBottom: '8px',
                        color: getAsVar(VSC_FOREGROUND),
                    }}
                >
                    <span style={{ flexShrink: 1, minWidth: 0 }}>Max Requests:</span>
                    <VSCodeTextField
                        value={autoApprovalSettings.maxRequests.toString()}
                        onInput={(e) => {
                            const input = e.target as HTMLInputElement
                            input.value = input.value.replace(/[^0-9]/g, '')
                            const value = parseInt(input.value)
                            if (!isNaN(value) && value > 0) {
                                updateMaxRequests(value)
                            }
                        }}
                        onKeyDown={(e) => {
                            if (
                                !/^\d$/.test(e.key) &&
                                !['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight'].includes(e.key)
                            ) {
                                e.preventDefault()
                            }
                        }}
                        style={{ flex: 1 }}
                    />
                </div>
                <div
                    style={{
                        color: getAsVar(VSC_DESCRIPTION_FOREGROUND),
                        fontSize: '12px',
                        marginBottom: '10px',
                    }}
                >
                    PostHog will automatically make this many API requests before asking for approval to proceed with
                    the task.
                </div>
                <div style={{ margin: '6px 0' }}>
                    <VSCodeCheckbox
                        checked={autoApprovalSettings.enableNotifications}
                        onChange={(e) => {
                            const checked = (e.target as HTMLInputElement).checked
                            updateNotifications(checked)
                        }}
                    >
                        Enable Notifications
                    </VSCodeCheckbox>
                    <div
                        style={{
                            marginLeft: '28px',
                            color: getAsVar(VSC_DESCRIPTION_FOREGROUND),
                            fontSize: '12px',
                        }}
                    >
                        Receive system notifications when PostHog requires approval to proceed or when a task is
                        completed.
                    </div>
                </div>
            </div>
        </div>
    )
}

const HeaderSection = styled.div`
    display: flex;
    align-items: center;
    gap: 4px;
    color: ${getAsVar(VSC_DESCRIPTION_FOREGROUND)};
    flex: 1;
    min-width: 0;
`

export default AutoApproveMenu
