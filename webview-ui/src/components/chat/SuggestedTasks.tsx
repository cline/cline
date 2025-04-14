import { VSCodeButton } from '@vscode/webview-ui-toolkit/react'
import styled from 'styled-components'

interface SuggestedTasksProps {
    setInputValue: (value: string) => void
    handleSendMessage: (text: string, images: string[]) => void
}

const SuggestedTasks = ({ setInputValue, handleSendMessage }: SuggestedTasksProps) => {
    const suggestedTasks = [
        {
            title: 'Install PostHog',
            description: 'Set up PostHog analytics in your project',
            command:
                'Install PostHog in the current project. Do not add events to the project as part of this task, your goal is to get a working installation.',
        },
    ]

    const handleTaskClick = (command: string) => {
        setInputValue(command)
        setTimeout(() => {
            handleSendMessage(command, [])
        }, 100)
    }

    return (
        <div style={{ flexShrink: 0 }}>
            <style>
                {`
                    .suggested-task-item {
                        background-color: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 65%, transparent);
                        border-radius: 4px;
                        position: relative;
                        overflow: hidden;
                        opacity: 0.8;
                        cursor: pointer;
                        margin-bottom: 12px;
                    }
                    .suggested-task-item:hover {
                        background-color: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 100%, transparent);
                        opacity: 1;
                        pointer-events: auto;
                    }
                `}
            </style>

            <div
                style={{
                    color: 'var(--vscode-descriptionForeground)',
                    margin: '10px 20px 10px 20px',
                    display: 'flex',
                    alignItems: 'center',
                }}
            >
                <span
                    className="codicon codicon-lightbulb"
                    style={{
                        marginRight: '4px',
                        transform: 'scale(0.9)',
                    }}
                ></span>
                <span
                    style={{
                        fontWeight: 500,
                        fontSize: '0.85em',
                        textTransform: 'uppercase',
                    }}
                >
                    Suggested Tasks
                </span>
            </div>

            <div style={{ padding: '0px 20px 0 20px' }}>
                {suggestedTasks.map((task, index) => (
                    <div key={index} className="suggested-task-item" onClick={() => handleTaskClick(task.command)}>
                        <div style={{ padding: '12px' }}>
                            <div style={{ marginBottom: '8px' }}>
                                <span
                                    style={{
                                        color: 'var(--vscode-descriptionForeground)',
                                        fontWeight: 500,
                                        fontSize: '0.85em',
                                        textTransform: 'uppercase',
                                    }}
                                >
                                    {task.title}
                                </span>
                            </div>
                            <div
                                style={{
                                    fontSize: 'var(--vscode-font-size)',
                                    color: 'var(--vscode-descriptionForeground)',
                                    marginBottom: '8px',
                                    display: '-webkit-box',
                                    WebkitLineClamp: 3,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden',
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word',
                                    overflowWrap: 'anywhere',
                                }}
                            >
                                {task.description}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}

export default SuggestedTasks
