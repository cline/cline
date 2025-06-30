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

const ChatLayoutContainer = styled.div<{ isHidden: boolean }>`
	position: fixed;
	top: 0;
	left: 0;
	right: 0;
	bottom: 0;
	display: ${(props) => (props.isHidden ? "none" : "flex")};
	flex-direction: column;
	overflow: hidden;
`
