import { VSCodeButton } from '@vscode/webview-ui-toolkit/react'
import React, { memo } from 'react'
import { mentionRegexGlobal } from '../../../../src/shared/context-mentions'
import { vscode } from '../../utils/vscode'
import { PostHogMessage } from '../../../../src/shared/ExtensionMessage'

interface TaskHeaderProps {
    task: PostHogMessage
    onClose: () => void
}

const TaskHeader: React.FC<TaskHeaderProps> = ({ task, onClose }) => {
    return (
        <div style={{ padding: '10px 13px 10px 13px' }}>
            <div
                style={{
                    backgroundColor: 'var(--vscode-badge-background)',
                    color: 'var(--vscode-badge-foreground)',
                    borderRadius: '3px',
                    padding: '9px 10px 9px 10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    position: 'relative',
                    zIndex: 1,
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                    }}
                >
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            cursor: 'pointer',
                            marginLeft: -2,
                            userSelect: 'none',
                            WebkitUserSelect: 'none',
                            MozUserSelect: 'none',
                            msUserSelect: 'none',
                            flexGrow: 1,
                            minWidth: 0, // This allows the div to shrink below its content size
                        }}
                    >
                        <span style={{ marginLeft: 4 }}>{highlightMentions(task.text, false)}</span>
                    </div>
                    <VSCodeButton appearance="icon" onClick={onClose} style={{ marginLeft: 6, flexShrink: 0 }}>
                        <span className="codicon codicon-close"></span>
                    </VSCodeButton>
                </div>
            </div>
        </div>
    )
}

export const highlightMentions = (text?: string, withShadow = true) => {
    if (!text) return text
    const parts = text.split(mentionRegexGlobal)
    return parts.map((part, index) => {
        if (index % 2 === 0) {
            // This is regular text
            return part
        } else {
            // This is a mention
            return (
                <span
                    key={index}
                    className={withShadow ? 'mention-context-highlight-with-shadow' : 'mention-context-highlight'}
                    style={{ cursor: 'pointer' }}
                    onClick={() => vscode.postMessage({ type: 'openMention', text: part })}
                >
                    @{part}
                </span>
            )
        }
    })
}

export default memo(TaskHeader)
