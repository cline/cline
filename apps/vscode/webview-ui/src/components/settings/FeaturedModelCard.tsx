import React from "react"
import styled from "styled-components"

export interface FeaturedModelCardProps {
	modelId: string
	description: string
	onClick: () => void
	isSelected: boolean
	label: string
}

const CardContainer = styled.div<{ isSelected: boolean }>`
	padding: 2px 4px;
	margin-bottom: 2px;
	border-radius: 3px;
	border: 1px solid var(--vscode-textLink-foreground);
	opacity: ${(props) => (props.isSelected ? 1 : 0.6)};
	cursor: pointer;

	&:hover {
		background-color: var(--vscode-list-hoverBackground);
		opacity: 1;
	}
`

const ModelHeader = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
`

const ModelName = styled.div`
	font-weight: 500;
	font-size: 12px;
	line-height: 1.2;
`

const Label = styled.span`
	font-size: 10px;
	color: var(--vscode-textLink-foreground);
	text-transform: uppercase;
	letter-spacing: 0.5px;
	font-weight: 500;
`

const Description = styled.div`
	margin-top: 0px;
	font-size: 11px;
	color: var(--vscode-descriptionForeground);
	line-height: 1.2;
`

const FeaturedModelCard: React.FC<FeaturedModelCardProps> = ({ modelId, description, onClick, isSelected, label }) => {
	return (
		<CardContainer isSelected={isSelected} onClick={onClick}>
			<ModelHeader>
				<ModelName>{modelId}</ModelName>
				<Label>{label}</Label>
			</ModelHeader>
			<Description>{description}</Description>
		</CardContainer>
	)
}

export default FeaturedModelCard
