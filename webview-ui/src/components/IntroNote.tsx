import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import CloseableNote from "./common/CloseableNote"

type IntroNoteProps = {
    hideIntroNote: () => void
}

const IntroNote = ({ hideIntroNote }: IntroNoteProps) => {
    return (
        <CloseableNote 
            onClose={hideIntroNote}
            style={{ 
                flexShrink: 0,
                margin: '20px 20px 10px 20px',
                backgroundColor: 'color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 65%, transparent)'
            }}
        >
            <h2 style={{ margin: "0 0 8px" }}>What can I do for you?</h2>
            <p>
                Thanks to{" "}
                <VSCodeLink
                    href="https://www-cdn.anthropic.com/fed9cc193a14b84131812372d8d5857f8f304c52/Model_Card_Claude_3_Addendum.pdf"
                    style={{ display: "inline" }}>
                    Claude 3.5 Sonnet's agentic coding capabilities,
                </VSCodeLink>{" "}
                I can handle complex software development tasks step-by-step. With tools that let me create
                & edit files, explore complex projects, and execute terminal commands (after you grant
                permission), I can assist you in ways that go beyond simple code completion or tech support.
            </p>
        </CloseableNote>
    )
}

export default IntroNote