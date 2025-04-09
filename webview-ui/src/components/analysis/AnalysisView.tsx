import React, { useEffect, useState } from 'react'
import { vscode } from '../../utils/vscode'
import { PostHogUsage } from '../../../../src/analysis/codeAnalyzer'
import { useExtensionState } from '../../context/ExtensionStateContext'
import { VSCodeBadge, VSCodeButton } from '@vscode/webview-ui-toolkit/react'
import './AnalysisView.scss'

interface FileGroup {
    filePath: string
    usages: PostHogUsage[]
    warningCount: number
}

type AnalysisViewProps = {
    onDone: () => void
}

export const AnalysisView: React.FC<AnalysisViewProps> = ({ onDone }) => {
    const { posthogUsage: usages } = useExtensionState()
    const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set())
    const [fileGroups, setFileGroups] = useState<FileGroup[]>([])

    useEffect(() => {
        // Group usages by file
        const groupedUsages = usages.reduce(
            (acc, usage) => {
                if (!acc[usage.file]) {
                    acc[usage.file] = {
                        filePath: usage.file,
                        usages: [],
                        warningCount: 0,
                    }
                }
                acc[usage.file].usages.push(usage)
                if (usage.warning) {
                    acc[usage.file].warningCount += usage.warning.split(';').filter((w: string) => w.trim()).length
                }
                return acc
            },
            {} as Record<string, FileGroup>
        )

        setFileGroups(Object.values(groupedUsages).sort((a, b) => a.filePath.localeCompare(b.filePath)))
    }, [usages])

    const toggleFile = (filePath: string) => {
        const newExpanded = new Set(expandedFiles)
        if (newExpanded.has(filePath)) {
            newExpanded.delete(filePath)
        } else {
            newExpanded.add(filePath)
        }
        setExpandedFiles(newExpanded)
    }

    const onOpenFile = (usage: PostHogUsage) => {
        vscode.postMessage({
            type: 'openFileAtUsageLocation',
            usage,
        })
    }

    return (
        <div
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: 'flex',
                flexDirection: 'column',
            }}
        >
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 17px 5px 20px',
                }}
            >
                <h3
                    style={{
                        color: 'var(--vscode-foreground)',
                        margin: 0,
                    }}
                >
                    Usage Analysis
                </h3>
                <VSCodeButton onClick={onDone}>Done</VSCodeButton>
            </div>
            <div className="file-list">
                {fileGroups.length === 0 ? (
                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            height: '100%',
                            color: 'var(--vscode-foreground)',
                            opacity: 0.7,
                        }}
                    >
                        No PostHog usage found in the current folder
                    </div>
                ) : (
                    fileGroups.map((group) => (
                        <div key={group.filePath} className="file-group">
                            <div
                                className={`file-header ${expandedFiles.has(group.filePath) ? 'expanded' : ''}`}
                                onClick={() => toggleFile(group.filePath)}
                            >
                                <div className="tree-toggle" />
                                <span className="codicon codicon-file file-icon"></span>
                                <span className="file-name">{group.filePath.split('/').pop()}</span>
                                {group.warningCount > 0 && <VSCodeBadge>{group.warningCount}</VSCodeBadge>}
                            </div>
                            {expandedFiles.has(group.filePath) && (
                                <div className="usage-list">
                                    {group.usages.map((usage, index) => (
                                        <div className="usage-item-container">
                                            <div key={index} className="usage-item">
                                                <div className="usage-header">
                                                    <span className="usage-type">{usage.type}</span>
                                                    <span className="usage-context">{usage.context}</span>
                                                </div>
                                                {usage.warning && (
                                                    <div className="warning-details">
                                                        {usage.warning.split(';').map((w, i) => (
                                                            <div key={i} className="warning-item">
                                                                ⚠️ {w.trim()}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="open-file-button-container">
                                                <span
                                                    className="open-file-button codicon codicon-open-preview"
                                                    onClick={() => onOpenFile(usage)}
                                                ></span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>
    )
}
