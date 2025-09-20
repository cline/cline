import type React from "react"
import styled from "styled-components"

interface ChatLayoutProps {
	isHidden: boolean
	header?: React.ReactNode
	children: React.ReactNode
}

/**
 * Main layout container for the chat view
 * Provides the fixed positioning and flex layout structure
 */
export const ChatLayout: React.FC<ChatLayoutProps> = ({ isHidden, header, children }) => {
	return (
		<ChatLayoutContainer isHidden={isHidden}>
			{header}
			<MainContent>{children}</MainContent>
		</ChatLayoutContainer>
	)
}

const ChatLayoutContainer = styled.div.withConfig({
	shouldForwardProp: (prop) => !["isHidden"].includes(prop),
})<{ isHidden: boolean }>`
	display: ${(props) => (props.isHidden ? "none" : "grid")};
	grid-template-rows: auto 1fr;
	overflow: hidden;
	padding: 0;
	margin: 0;
	width: 100%;
	height: 100%;
	min-height: 100vh;
	position: relative;
`

const MainContent = styled.div`
	display: flex;
	flex-direction: column;
	overflow: hidden;
	grid-row: 2;
`
