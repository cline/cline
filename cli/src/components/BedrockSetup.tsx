import BedrockData from "@shared/providers/bedrock.json"
import { Box, Text, useInput } from "ink"
import React, { useCallback, useMemo, useState } from "react"
import { COLORS } from "../constants/colors"
import { useStdinContext } from "../context/StdinContext"
import { useScrollableList } from "../hooks/useScrollableList"
import { isMouseEscapeSequence } from "../utils/input"

type AuthMethod = "profile" | "credentials" | "default"

type BedrockStep = "auth_method" | "profile_name" | "access_key" | "secret_key" | "session_token" | "region" | "options"

export interface BedrockConfig {
	awsAuthentication: string
	awsProfile?: string
	awsAccessKey?: string
	awsSecretKey?: string
	awsSessionToken?: string
	awsRegion: string
	awsUseCrossRegionInference: boolean
}

interface BedrockSetupProps {
	isActive: boolean
	onComplete: (config: BedrockConfig) => void
	onCancel: () => void
}

const AUTH_METHODS: { label: string; value: AuthMethod; description: string }[] = [
	{ label: "AWS Profile", value: "profile", description: "Use a named profile from ~/.aws/credentials" },
	{ label: "AWS Credentials", value: "credentials", description: "Enter access key, secret key, and optional session token" },
	{
		label: "Default credential chain",
		value: "default",
		description: "Resolve from env vars, IAM role, or ~/.aws/credentials",
	},
]

const AWS_REGIONS = BedrockData.regions
const REGION_ROWS = 8

/**
 * Inline text input for credential fields
 */
const CredentialInput: React.FC<{
	label: string
	value: string
	onChange: (value: string) => void
	onSubmit: () => void
	onCancel: () => void
	isActive: boolean
	isPassword?: boolean
	placeholder?: string
	hint?: string
}> = ({ label, value, onChange, onSubmit, onCancel, isActive, isPassword, placeholder, hint }) => {
	const { isRawModeSupported } = useStdinContext()

	useInput(
		(input, key) => {
			if (isMouseEscapeSequence(input)) return
			if (key.escape) {
				onCancel()
			} else if (key.return) {
				onSubmit()
			} else if (key.backspace || key.delete) {
				onChange(value.slice(0, -1))
			} else if (input && !key.ctrl && !key.meta) {
				onChange(value + input)
			}
		},
		{ isActive: isActive && isRawModeSupported },
	)

	const displayValue = isPassword && value ? "•".repeat(value.length) : value

	// Combine hint and placeholder into description shown above input
	const description = hint || (placeholder ? `e.g. ${placeholder}` : undefined)

	return (
		<Box flexDirection="column">
			<Text color="white">{label}</Text>
			{description && <Text color="gray">{description}</Text>}
			<Text> </Text>
			<Box>
				<Text color="white">{displayValue}</Text>
				<Text inverse> </Text>
			</Box>
			<Text> </Text>
			<Text color="gray">Enter to continue, Esc to go back</Text>
		</Box>
	)
}

export const BedrockSetup: React.FC<BedrockSetupProps> = ({ isActive, onComplete, onCancel }) => {
	const { isRawModeSupported } = useStdinContext()

	const [step, setStep] = useState<BedrockStep>("auth_method")
	const [authMethodIndex, setAuthMethodIndex] = useState(0)
	const [authMethod, setAuthMethod] = useState<AuthMethod>("profile")

	// Credential state
	const [profileName, setProfileName] = useState("")
	const [accessKey, setAccessKey] = useState("")
	const [secretKey, setSecretKey] = useState("")
	const [sessionToken, setSessionToken] = useState("")

	// Region state
	const [regionSearch, setRegionSearch] = useState("")
	const [regionIndex, setRegionIndex] = useState(0)

	// Options state
	const [crossRegion, setCrossRegion] = useState(false)
	const [optionIndex, setOptionIndex] = useState(0)

	// Filtered regions
	const filteredRegions = useMemo(() => {
		const search = regionSearch.toLowerCase()
		return search ? AWS_REGIONS.filter((r) => r.includes(search)) : AWS_REGIONS
	}, [regionSearch])

	const {
		visibleStart: regionVisibleStart,
		visibleCount: regionVisibleCount,
		showTopIndicator: showRegionTop,
		showBottomIndicator: showRegionBottom,
	} = useScrollableList(filteredRegions.length, regionIndex, REGION_ROWS)

	const visibleRegions = useMemo(
		() => filteredRegions.slice(regionVisibleStart, regionVisibleStart + regionVisibleCount),
		[filteredRegions, regionVisibleStart, regionVisibleCount],
	)

	const nextStepAfterAuth = useCallback((method: AuthMethod) => {
		setAuthMethod(method)
		if (method === "profile") {
			setStep("profile_name")
		} else if (method === "credentials") {
			setStep("access_key")
		} else {
			// default chain - skip credentials, go to region
			setStep("region")
		}
	}, [])

	const goBack = useCallback(() => {
		switch (step) {
			case "auth_method":
				onCancel()
				break
			case "profile_name":
				setStep("auth_method")
				break
			case "access_key":
				setStep("auth_method")
				break
			case "secret_key":
				setStep("access_key")
				break
			case "session_token":
				setStep("secret_key")
				break
			case "region":
				if (authMethod === "profile") setStep("profile_name")
				else if (authMethod === "credentials") setStep("session_token")
				else setStep("auth_method")
				break
			case "options":
				setStep("region")
				break
		}
	}, [step, authMethod, onCancel])

	const finish = useCallback(() => {
		const config: BedrockConfig = {
			awsAuthentication: authMethod === "default" ? "credentials" : authMethod,
			awsRegion: filteredRegions[regionIndex] || "us-east-1",
			awsUseCrossRegionInference: crossRegion,
		}
		if (authMethod === "profile") {
			config.awsProfile = profileName || ""
		} else if (authMethod === "credentials") {
			config.awsAccessKey = accessKey
			config.awsSecretKey = secretKey
			if (sessionToken) config.awsSessionToken = sessionToken
		}
		onComplete(config)
	}, [authMethod, profileName, accessKey, secretKey, sessionToken, filteredRegions, regionIndex, crossRegion, onComplete])

	// Handle input for auth_method, region, and options steps
	useInput(
		(input, key) => {
			if (isMouseEscapeSequence(input)) return

			if (step === "auth_method") {
				if (key.escape) {
					onCancel()
				} else if (key.upArrow) {
					setAuthMethodIndex((prev) => (prev > 0 ? prev - 1 : AUTH_METHODS.length - 1))
				} else if (key.downArrow) {
					setAuthMethodIndex((prev) => (prev < AUTH_METHODS.length - 1 ? prev + 1 : 0))
				} else if (key.return) {
					nextStepAfterAuth(AUTH_METHODS[authMethodIndex].value)
				}
			} else if (step === "region") {
				if (key.escape) {
					goBack()
				} else if (key.upArrow) {
					setRegionIndex((prev) => (prev > 0 ? prev - 1 : filteredRegions.length - 1))
				} else if (key.downArrow) {
					setRegionIndex((prev) => (prev < filteredRegions.length - 1 ? prev + 1 : 0))
				} else if (key.return && filteredRegions.length > 0) {
					setStep("options")
				} else if (key.backspace || key.delete) {
					setRegionSearch((prev) => prev.slice(0, -1))
					setRegionIndex(0)
				} else if (input && !key.ctrl && !key.meta) {
					setRegionSearch((prev) => prev + input)
					setRegionIndex(0)
				}
			} else if (step === "options") {
				if (key.escape) {
					goBack()
				} else if (key.tab || key.return || input === " ") {
					// Tab/Enter/Space on checkbox toggles it, on Done button finishes
					if (optionIndex === 0) {
						setCrossRegion((prev) => !prev)
					} else {
						finish()
					}
				} else if (key.upArrow) {
					setOptionIndex((prev) => (prev > 0 ? prev - 1 : 1))
				} else if (key.downArrow) {
					setOptionIndex((prev) => (prev < 1 ? prev + 1 : 0))
				}
			}
		},
		{ isActive: isActive && isRawModeSupported && (step === "auth_method" || step === "region" || step === "options") },
	)

	if (step === "auth_method") {
		return (
			<Box flexDirection="column">
				<Text color="white">Authentication method</Text>
				<Text> </Text>
				{AUTH_METHODS.map((method, i) => (
					<Box flexDirection="column" key={method.value} marginBottom={i < AUTH_METHODS.length - 1 ? 1 : 0}>
						<Text color={i === authMethodIndex ? COLORS.primaryBlue : undefined}>
							{i === authMethodIndex ? "❯ " : "  "}
							{method.label}
						</Text>
						<Box paddingLeft={2}>
							<Text color="gray">{method.description}</Text>
						</Box>
					</Box>
				))}
				<Text> </Text>
				<Text color="gray">Arrows to navigate, Enter to select, Esc to go back</Text>
			</Box>
		)
	}

	if (step === "profile_name") {
		return (
			<CredentialInput
				hint="Leave empty to use the default profile"
				isActive={isActive}
				label="AWS Profile Name"
				onCancel={goBack}
				onChange={setProfileName}
				onSubmit={() => setStep("region")}
				placeholder="default"
				value={profileName}
			/>
		)
	}

	if (step === "access_key") {
		return (
			<CredentialInput
				isActive={isActive}
				isPassword
				label="AWS Access Key"
				onCancel={goBack}
				onChange={setAccessKey}
				onSubmit={() => {
					if (accessKey.trim()) setStep("secret_key")
				}}
				placeholder="Enter access key..."
				value={accessKey}
			/>
		)
	}

	if (step === "secret_key") {
		return (
			<CredentialInput
				isActive={isActive}
				isPassword
				label="AWS Secret Key"
				onCancel={goBack}
				onChange={setSecretKey}
				onSubmit={() => {
					if (secretKey.trim()) setStep("session_token")
				}}
				placeholder="Enter secret key..."
				value={secretKey}
			/>
		)
	}

	if (step === "session_token") {
		return (
			<CredentialInput
				hint="Optional - for temporary credentials"
				isActive={isActive}
				isPassword
				label="AWS Session Token"
				onCancel={goBack}
				onChange={setSessionToken}
				onSubmit={() => setStep("region")}
				placeholder="Enter session token (optional)..."
				value={sessionToken}
			/>
		)
	}

	if (step === "region") {
		return (
			<Box flexDirection="column">
				<Text color="white">AWS Region</Text>
				<Text> </Text>
				<Box>
					<Text color="gray">Search: </Text>
					<Text color="white">{regionSearch}</Text>
					<Text inverse> </Text>
				</Box>
				<Text> </Text>
				{showRegionTop && <Text color="gray">... {regionVisibleStart} more above</Text>}
				{visibleRegions.map((region, i) => {
					const actualIndex = regionVisibleStart + i
					return (
						<Box key={region}>
							<Text color={actualIndex === regionIndex ? COLORS.primaryBlue : undefined}>
								{actualIndex === regionIndex ? "❯ " : "  "}
								{region}
							</Text>
						</Box>
					)
				})}
				{showRegionBottom && (
					<Text color="gray">... {filteredRegions.length - regionVisibleStart - regionVisibleCount} more below</Text>
				)}
				{filteredRegions.length === 0 && <Text color="gray">No regions match "{regionSearch}"</Text>}
				<Text> </Text>
				<Text color="gray">Type to search, arrows to navigate, Enter to select, Esc to go back</Text>
			</Box>
		)
	}

	if (step === "options") {
		return (
			<Box flexDirection="column">
				<Text color="white">Options</Text>
				<Text> </Text>
				<Text color={optionIndex === 0 ? COLORS.primaryBlue : undefined}>
					{optionIndex === 0 ? "❯ " : "  "}
					{crossRegion ? "[x]" : "[ ]"} Use cross-region inference
				</Text>
				<Text> </Text>
				<Text color={optionIndex === 1 ? COLORS.primaryBlue : undefined}>
					{optionIndex === 1 ? "❯ " : "  "}
					Done
				</Text>
				<Text> </Text>
				<Text color="gray">Arrows to navigate, Enter to select, Esc to go back</Text>
			</Box>
		)
	}

	return null
}
