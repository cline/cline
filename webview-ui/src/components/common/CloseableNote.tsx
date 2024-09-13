import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

type CloseableNoteProps = {
    children: React.ReactNode
    onClose: () => void
    style?: React.CSSProperties
}

const CloseableNote = ({ children, onClose, style }: CloseableNoteProps) => {
  return (
    <div
        style={{
            backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)",
            borderRadius: "3px",
            padding: "12px 12px",
            position: "relative",
            flexShrink: 0,
            ...style,
        }}>
        <VSCodeButton
            appearance="icon"
            onClick={onClose}
            style={{ position: "absolute", top: "8px", right: "8px" }}>
            <span className="codicon codicon-close"></span>
        </VSCodeButton>
        {children}
    </div>
  )
}

export default CloseableNote