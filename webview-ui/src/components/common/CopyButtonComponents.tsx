import React, { useState, useRef, forwardRef } from "react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import styled from "styled-components"

// ======== Interfaces ========

interface CopyButtonProps {
  textToCopy?: string
  onCopy?: () => string | void | null // Allow onCopy to return null
  className?: string
  ariaLabel?: string
}

interface WithCopyButtonProps {
  children: React.ReactNode
  textToCopy?: string
  onCopy?: () => string | void | null // Allow onCopy to return null
  position?: "top-right" | "bottom-right"
  style?: React.CSSProperties
  className?: string
  onMouseUp?: (event: React.MouseEvent<HTMLDivElement>) => void
}

interface PreWithCopyButtonProps {
  children: React.ReactNode
  theme?: Record<string, string>
  [key: string]: any
}

// ======== Styled Components ========

const StyledButton = styled(VSCodeButton)`
  z-index: 1;
`

// Styled container for WithCopyButton
const GeneralContainer = styled.div`
  position: relative;
`

const ButtonContainer = styled.div<{ $position: string }>`
  position: absolute;
  ${props => props.$position === "top-right" ? "top: 5px; right: 5px;" : "bottom: 2px; right: 2px;"}
  opacity: 0;
  
  ${GeneralContainer}:hover & {
    opacity: 1;
  }
`
// Styled container for PreWithCopyButton (specifically for code blocks)
const CodeBlockContainerWrapper = styled.div`
  position: relative;
`

const ButtonWrapper = styled.div`
  position: absolute;
  top: 5px;
  right: 5px;
  z-index: 1;
  opacity: 0;
  
  ${CodeBlockContainerWrapper}:hover & {
    opacity: 1;
  }
`

// StyledPre for use within PreWithCopyButton
const StyledPre = styled.pre<{ theme?: Record<string, string> }>`
  & .hljs {
    color: var(--vscode-editor-foreground, #fff);
  }

  ${(props) =>
    props.theme && Object.keys(props.theme)
      .map((key) => {
        return `
      & ${key} {
        color: ${props.theme?.[key]};
      }
    `
      })
      .join("")}
`

// ======== Component Implementations ========

/**
 * Base copy button component with clipboard functionality
 */
export const CopyButton: React.FC<CopyButtonProps> = ({
  textToCopy,
  onCopy,
  className = "",
  ariaLabel,
}) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    if (!textToCopy && !onCopy) return
    
    let textToCopyFinal = textToCopy;
    
    if (onCopy) {
      const result = onCopy();
      if (typeof result === 'string') {
        textToCopyFinal = result;
      }
    }
    
    if (textToCopyFinal) {
      navigator.clipboard.writeText(textToCopyFinal)
        .then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
        .catch(err => console.error("Copy failed", err))
    }
  }

  return (
    <StyledButton
      appearance="icon"
      onClick={handleCopy}
      className={className}
      aria-label={ariaLabel || (copied ? "Copied" : "Copy")}
    >
      <span className={`codicon codicon-${copied ? "check" : "copy"}`}></span>
    </StyledButton>
  )
}

/**
 * Container component that wraps content with a copy button
 */
export const WithCopyButton = forwardRef<HTMLDivElement, WithCopyButtonProps>(({
  children,
  textToCopy,
  onCopy,
  position = "top-right",
  style,
  className,
  onMouseUp,
  ...props
}, ref) => {
  return (
    <GeneralContainer
      ref={ref}
      onMouseUp={onMouseUp}
      style={style}
      className={className}
      {...props}
    >
      {children}
      {(textToCopy || onCopy) && (
        <ButtonContainer $position={position}>
          <CopyButton
            textToCopy={textToCopy}
            onCopy={onCopy}
            ariaLabel={textToCopy ? "Copy text" : "Copy code"}
          />
        </ButtonContainer>
      )}
    </GeneralContainer>
  )
})

/**
 * Specialized component for code blocks in markdown that need copy functionality
 */
export const PreWithCopyButton: React.FC<PreWithCopyButtonProps> = ({
  children,
  theme,
  ...preProps
}) => {
  const preRef = useRef<HTMLPreElement>(null)
  
  const handleCopy = () => {
    if (!preRef.current) return null
    const codeElement = preRef.current.querySelector("code")
    const textToCopyResult = codeElement ? codeElement.textContent : preRef.current.textContent
    if (!textToCopyResult) return null
    return textToCopyResult
  }

  // Pass theme to the pre element if it exists
  // Pass theme to the StyledPre element if it exists
  const styledPreProps = theme ? { ...preProps, theme } : preProps;

  return (
    <CodeBlockContainerWrapper>
      <ButtonWrapper>
        <CopyButton onCopy={handleCopy} ariaLabel="Copy code" />
      </ButtonWrapper>
      <StyledPre {...styledPreProps} ref={preRef}>
        {children}
      </StyledPre>
    </CodeBlockContainerWrapper>
  )
}

// Default export for convenience if needed, though named exports are preferred for clarity
const CopyButtonComponents = {
  CopyButton,
  WithCopyButton,
  PreWithCopyButton
}
export default CopyButtonComponents
