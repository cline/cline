import React, { TextareaHTMLAttributes, CSSProperties, useRef, useEffect } from "react"

interface ResizingTextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> {
	onChange: (value: string) => void
}

const ResizingTextArea= ({ style, value, onChange, ...props }: ResizingTextAreaProps) => {
	const textAreaRef = useRef<HTMLTextAreaElement>(null)

	const textareaStyle: CSSProperties = {
		width: "100%",
		minHeight: "60px",
		backgroundColor: "var(--vscode-input-background, #3c3c3c)",
		color: "var(--vscode-input-foreground, #cccccc)",
		border: "1px solid var(--vscode-input-border, #3c3c3c)",
		borderRadius: "2px",
		padding: "4px 8px",
		outline: "none",
		fontFamily: "var(--vscode-editor-font-family)",
		fontSize: "var(--vscode-editor-font-size, 13px)",
		lineHeight: "var(--vscode-editor-line-height, 1.5)",
		resize: "none",
		overflow: "hidden",
		...style,
	}

	const adjustTextAreaHeight = () => {
		if (textAreaRef.current) {
			textAreaRef.current.style.height = "auto"
			textAreaRef.current.style.height = `${textAreaRef.current.scrollHeight}px`
		}
	}

	const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
		onChange(event.target.value)
		adjustTextAreaHeight()
	}

	useEffect(() => {
		adjustTextAreaHeight()
	}, [value])

	return <textarea ref={textAreaRef} style={textareaStyle} value={value} onChange={handleInputChange} {...props} />
}

export default ResizingTextArea
