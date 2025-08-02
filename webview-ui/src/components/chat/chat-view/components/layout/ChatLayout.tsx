import React from "react"
import styled from "styled-components"

interface ChatLayoutProps {
	isHidden: boolean
	children: React.ReactNode
}

/**
 * Main layout container for the chat view
 * Provides the fixed positioning and flex layout structure
 */
export const ChatLayout: React.FC<ChatLayoutProps> = ({ isHidden, children }) => {
	return <ChatLayoutContainer isHidden={isHidden}>{children}</ChatLayoutContainer>
}

const ChatLayoutContainer = styled.div.withConfig({
	shouldForwardProp: (prop) => !["isHidden"].includes(prop),
})<{ isHidden: boolean }>`
	display: ${(props) => (props.isHidden ? "none" : "flex")};
	flex-direction: column;
	overflow: hidden;
	padding: 0;
	margin: 0;
	width: 100%;
	height: 100%;
	min-height: 100vh;
`
