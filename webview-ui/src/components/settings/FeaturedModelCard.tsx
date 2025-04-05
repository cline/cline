import React from "react"
import styled from "styled-components"

export interface FeaturedModelCardProps {
	modelId: string
	tags: string[]
	description: string
	colorClass: string
	onClick: () => void
	isSelected: boolean
}

const CardContainer = styled.div<{ isSelected: boolean }>`
	padding: 10px;
	margin-bottom: 8px;
	border-radius: 4px;
	border: 1px solid ${(props) => (props.isSelected ? "var(--vscode-focusBorder)" : "var(--vscode-widget-border)")};
	cursor: pointer;
	transition: background-color 0.1s ease;

	&:hover {
		background-color: var(--vscode-list-hoverBackground);
	}
`

const ModelHeader = styled.div`
	display: flex;
	align-items: center;
`

const ColorIndicator = styled.div<{ colorClass: string }>`
	width: 10px;
	height: 10px;
	border-radius: 50%;
	margin-right: 8px;
	background-color: ${(props) => {
		switch (props.colorClass) {
			case "green-600":
				return "var(--vscode-charts-green)"
			case "green-500":
				return "var(--vscode-debugIcon.startForeground)"
			case "green-400":
				return "var(--vscode-gitDecoration.addedResourceForeground)"
			default:
				return "var(--vscode-charts-green)"
		}
	}};
`

const ModelName = styled.div`
	font-weight: 500;
	font-size: 13px;
`

const TagsContainer = styled.div`
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
	margin-top: 8px;
`

const Tag = styled.span`
	font-size: 11px;
	padding: 2px 6px;
	border-radius: 10px;
	background-color: var(--vscode-badge-background);
	color: var(--vscode-badge-foreground);
`

const Description = styled.div`
	margin-top: 4px;
	font-size: 12px;
	color: var(--vscode-descriptionForeground);
`

const FeaturedModelCard: React.FC<FeaturedModelCardProps> = ({ modelId, tags, description, colorClass, onClick, isSelected }) => {
	return (
		<CardContainer isSelected={isSelected} onClick={onClick}>
			<ModelHeader>
				<ColorIndicator colorClass={colorClass} />
				<ModelName>{modelId}</ModelName>
			</ModelHeader>
			<TagsContainer>
				{tags.map((tag) => (
					<Tag key={tag}>#{tag}</Tag>
				))}
			</TagsContainer>
			<Description>{description}</Description>
		</CardContainer>
	)
}

export default FeaturedModelCard
