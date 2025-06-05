import React, { useState, useEffect } from "react"
import styled, { css, keyframes } from "styled-components"
import { ApiConfiguration } from "@shared/api"

interface MakeHubPerfRatioSliderProps {
	apiConfiguration?: ApiConfiguration
	onChange: (value: number) => void
}

const SliderContainer = styled.div`
	margin-bottom: 15px;
`

// Interface pour les props des labels animés
interface AnimatedLabelProps {
	isActive: boolean
}

const AnimatedLabel = styled.span<AnimatedLabelProps>`
	font-weight: 500;
	transition:
		color 0.3s ease,
		transform 0.3s ease;

	${(props) =>
		props.isActive &&
		css`
			color: var(--vscode-button-foreground);
			transform: scale(1.05);
			font-weight: 600;
		`}
`

const SliderLabels = styled.div`
	display: flex;
	justify-content: space-between;
	font-size: 12px;
	margin-top: 3px;
	color: var(--vscode-descriptionForeground);
`

// Définir l'interface pour les props du StyledSlider
interface StyledSliderProps {
	sliderValue: number // Renommé de $value à sliderValue pour éviter les conflits
}

// Utiliser cette interface pour le composant styled
const StyledSlider = styled.input<StyledSliderProps>`
	-webkit-appearance: none;
	width: 100%;
	height: 6px;
	border-radius: 3px;
	background: linear-gradient(
		to right,
		var(--vscode-progressBar-background) 0%,
		var(--vscode-progressBar-background) ${(props) => props.sliderValue * 100}%,
		var(--vscode-editor-background) ${(props) => props.sliderValue * 100}%,
		var(--vscode-editor-background) 100%
	);
	outline: none;
	border: 1px solid var(--vscode-button-secondaryBorder);
	margin: 10px 0;
	position: relative;

	/* Supprimer l'outline de focus */
	&:focus {
		outline: none;
		box-shadow: none;
		border-color: var(--vscode-button-secondaryBorder);
	}

	/* Désactiver le contour de sélection sur l'ensemble du slider */
	&,
	&:active,
	&:hover {
		outline: none;
		-webkit-tap-highlight-color: transparent;
	}

	&::-webkit-slider-runnable-track {
		height: 6px;
		cursor: pointer;
		border-radius: 3px;
	}

	&::-moz-range-track {
		height: 6px;
		cursor: pointer;
		border-radius: 3px;
		background: var(--vscode-editor-background);
	}

	&::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--vscode-button-background);
		cursor: pointer;
		border: 1px solid var(--vscode-button-border);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
		margin-top: -5px; /* Pour centrer verticalement le point sur la barre */
		will-change: transform;
	}

	&::-moz-range-thumb {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--vscode-button-background);
		cursor: pointer;
		border: 1px solid var(--vscode-button-border);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
		position: relative;
		z-index: 2; /* Assure que le point est au-dessus de la barre */
		will-change: transform;
	}

	&:hover::-webkit-slider-thumb {
		background: var(--vscode-button-hoverBackground);
	}

	&:hover::-moz-range-thumb {
		background: var(--vscode-button-hoverBackground);
	}

	&:active::-webkit-slider-thumb {
		background: var(--vscode-button-background);
		box-shadow: 0 1px 5px rgba(0, 0, 0, 0.3);
	}

	&:active::-moz-range-thumb {
		background: var(--vscode-button-background);
		box-shadow: 0 1px 5px rgba(0, 0, 0, 0.3);
	}
`

const SliderHeader = styled.div`
	font-weight: 500;
	margin-bottom: 8px;
	display: flex;
	justify-content: space-between;
	align-items: center;
`

const ValueDisplay = styled.span`
	font-size: 12px;
	color: var(--vscode-foreground);
	opacity: 0.7;
	padding: 2px 8px;
	border-radius: 4px;
	background-color: var(--vscode-editor-background);
	transition: opacity 0.2s ease;

	&:hover {
		opacity: 1;
	}
`

/**
 * A slider component that controls the performance vs price ratio for MakeHub models
 */
const MakeHubPerfRatioSlider: React.FC<MakeHubPerfRatioSliderProps> = ({ apiConfiguration, onChange }) => {
	// Use a default value of 0.5 if not set
	const value = apiConfiguration?.makehubPerfRatio !== undefined ? apiConfiguration.makehubPerfRatio : 0.5

	// Check if the value is in an extreme range (below 0.1 or above 0.9)
	const isExtremeLeft = value <= 0.1
	const isExtremeRight = value >= 0.9

	// Format the value as a percentage
	const formattedValue = `${Math.round(value * 100)}%`

	const handleChange = React.useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			onChange(parseFloat(e.target.value))
		},
		[onChange],
	)

	return (
		<SliderContainer>
			<SliderHeader>
				Optimization Balance
				<ValueDisplay>{formattedValue}</ValueDisplay>
			</SliderHeader>

			<StyledSlider
				id="makehub-perf-ratio-slider"
				type="range"
				min="0"
				max="1"
				step="0.01"
				value={value}
				onChange={handleChange}
				sliderValue={value}
			/>

			<SliderLabels>
				<AnimatedLabel isActive={isExtremeLeft}>Cost optimization</AnimatedLabel>
				<AnimatedLabel isActive={isExtremeRight}>Speed optimization</AnimatedLabel>
			</SliderLabels>
		</SliderContainer>
	)
}

// Utilisation de React.memo pour éviter les rendus inutiles
export default React.memo(MakeHubPerfRatioSlider)
