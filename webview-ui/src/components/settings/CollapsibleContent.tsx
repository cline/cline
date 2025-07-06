import styled from "styled-components"

const CollapsibleContent = styled.div<{ isOpen: boolean }>`
	overflow: hidden;
	transition:
		max-height 0.3s ease-in-out,
		opacity 0.3s ease-in-out,
		margin-top 0.3s ease-in-out,
		visibility 0.3s ease-in-out;
	max-height: ${({ isOpen }) => (isOpen ? "1000px" : "0")};
	opacity: ${({ isOpen }) => (isOpen ? 1 : 0)};
	margin-top: ${({ isOpen }) => (isOpen ? "15px" : "0")};
	visibility: ${({ isOpen }) => (isOpen ? "visible" : "hidden")};
`

export default CollapsibleContent
