import React, { useState, useMemo, useEffect } from "react"
import { MarketplaceItem, McpParameter, McpInstallationMethod } from "@roo-code/types"
import { vscode } from "@/utils/vscode"
import { useAppTranslation } from "@/i18n/TranslationContext"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface MarketplaceInstallModalProps {
	item: MarketplaceItem | null
	isOpen: boolean
	onClose: () => void
	hasWorkspace: boolean
}

export const MarketplaceInstallModal: React.FC<MarketplaceInstallModalProps> = ({
	item,
	isOpen,
	onClose,
	hasWorkspace,
}) => {
	const { t } = useAppTranslation()
	const [scope, setScope] = useState<"project" | "global">(hasWorkspace ? "project" : "global")
	const [selectedMethodIndex, setSelectedMethodIndex] = useState(0)
	const [parameterValues, setParameterValues] = useState<Record<string, string>>({})
	const [validationError, setValidationError] = useState<string | null>(null)
	const [installationComplete, setInstallationComplete] = useState(false)

	// Reset state when item changes
	React.useEffect(() => {
		if (item) {
			setSelectedMethodIndex(0)
			setParameterValues({})
			setValidationError(null)
			setInstallationComplete(false)
		}
	}, [item])

	// Check if item has multiple installation methods
	const hasMultipleMethods = useMemo(() => {
		return item && Array.isArray(item.content) && item.content.length > 1
	}, [item])

	// Get installation method names (for display in dropdown)
	const methodNames = useMemo(() => {
		if (!item || !Array.isArray(item.content)) return []

		// Content is an array of McpInstallationMethod objects
		return (item.content as Array<{ name: string; content: string }>).map((method) => method.name)
	}, [item])

	// Get effective parameters for the selected method (global + method-specific)
	const effectiveParameters = useMemo(() => {
		if (!item) return []

		const globalParams = item.type === "mcp" ? item.parameters || [] : []
		let methodParams: McpParameter[] = []

		// Get method-specific parameters if content is an array
		if (Array.isArray(item.content)) {
			const selectedMethod = item.content[selectedMethodIndex] as McpInstallationMethod
			methodParams = selectedMethod?.parameters || []
		}

		// Create map with global params first, then override with method-specific ones
		const paramMap = new Map<string, McpParameter>()
		globalParams.forEach((p) => paramMap.set(p.key, p))
		methodParams.forEach((p) => paramMap.set(p.key, p))

		return Array.from(paramMap.values())
	}, [item, selectedMethodIndex])

	// Get effective prerequisites for the selected method (global + method-specific)
	const effectivePrerequisites = useMemo(() => {
		if (!item) return []

		const globalPrereqs = item.prerequisites || []
		let methodPrereqs: string[] = []

		// Get method-specific prerequisites if content is an array
		if (Array.isArray(item.content)) {
			const selectedMethod = item.content[selectedMethodIndex] as McpInstallationMethod
			methodPrereqs = selectedMethod?.prerequisites || []
		}

		// Combine and deduplicate prerequisites
		const allPrereqs = [...globalPrereqs, ...methodPrereqs]
		return Array.from(new Set(allPrereqs))
	}, [item, selectedMethodIndex])

	// Update parameter values when method changes
	React.useEffect(() => {
		if (item) {
			// Get effective parameters for current method
			const globalParams = item.type === "mcp" ? item.parameters || [] : []
			let methodParams: McpParameter[] = []

			if (Array.isArray(item.content)) {
				const selectedMethod = item.content[selectedMethodIndex] as McpInstallationMethod
				methodParams = selectedMethod?.parameters || []
			}

			// Create map with global params first, then override with method-specific ones
			const paramMap = new Map<string, McpParameter>()
			globalParams.forEach((p) => paramMap.set(p.key, p))
			methodParams.forEach((p) => paramMap.set(p.key, p))

			const currentEffectiveParams = Array.from(paramMap.values())

			// Initialize parameter values for effective parameters
			setParameterValues((prev) => {
				const newValues: Record<string, string> = {}
				currentEffectiveParams.forEach((param) => {
					// Keep existing value if it exists, otherwise empty string
					newValues[param.key] = prev[param.key] || ""
				})
				return newValues
			})
		}
	}, [item, selectedMethodIndex])

	// Listen for installation result messages
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "marketplaceInstallResult" && message.slug === item?.id) {
				if (message.success) {
					// Installation succeeded - show success state
					setInstallationComplete(true)
					setValidationError(null)
				} else {
					// Installation failed - show error
					setValidationError(message.error || "Installation failed")
					setInstallationComplete(false)
				}
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [item?.id])

	const handleInstall = () => {
		if (!item) return

		// Clear previous validation error
		setValidationError(null)

		// Validate required parameters from effective parameters (global + method-specific)
		for (const param of effectiveParameters) {
			// Only validate if parameter is not optional (optional defaults to false)
			if (!param.optional && !parameterValues[param.key]?.trim()) {
				setValidationError(t("marketplace:install.validationRequired", { paramName: param.name }))
				return
			}
		}

		// Prepare parameters - ensure optional parameters have empty string if not provided
		const finalParameters: Record<string, any> = { ...parameterValues }
		for (const param of effectiveParameters) {
			if (param.optional && !finalParameters[param.key]) {
				finalParameters[param.key] = ""
			}
		}

		// Send install message with parameters
		vscode.postMessage({
			type: "installMarketplaceItem",
			mpItem: item,
			mpInstallOptions: {
				target: scope,
				parameters: {
					...finalParameters,
					_selectedIndex: hasMultipleMethods ? selectedMethodIndex : undefined,
				},
			},
		})

		// Don't show success immediately - wait for backend result
		// The success state will be shown when installation actually succeeds
		setValidationError(null)
	}

	const handlePostInstallAction = (tab: "mcp" | "modes") => {
		// Send message to switch to the appropriate tab
		vscode.postMessage({ type: "switchTab", tab })
		// Close the modal
		onClose()
	}

	if (!item) return null

	return (
		<Dialog open={isOpen} onOpenChange={onClose}>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle>
						{installationComplete
							? t("marketplace:install.successTitle", { name: item.name })
							: item.type === "mcp"
								? t("marketplace:install.titleMcp", { name: item.name })
								: t("marketplace:install.titleMode", { name: item.name })}
					</DialogTitle>
					<DialogDescription>
						{installationComplete ? (
							t("marketplace:install.successDescription")
						) : item.type === "mcp" && item.url ? (
							<a
								href={item.url}
								target="_blank"
								rel="noopener noreferrer"
								className="text-primary hover:underline inline-flex items-center gap-1">
								{t("marketplace:install.moreInfoMcp", { name: item.name })}
							</a>
						) : null}
					</DialogDescription>
				</DialogHeader>

				{installationComplete ? (
					// Post-installation options
					<div className="space-y-4 py-2">
						<div className="text-center space-y-4">
							<div className="text-green-500 text-lg">✓ {t("marketplace:install.installed")}</div>
							<p className="text-sm text-muted-foreground">
								{item.type === "mcp"
									? t("marketplace:install.whatNextMcp")
									: t("marketplace:install.whatNextMode")}
							</p>
						</div>
					</div>
				) : (
					// Installation configuration
					<div className="space-y-4 py-2">
						{/* Installation Scope */}
						<div className="space-y-2">
							<div className="text-base font-semibold">{t("marketplace:install.scope")}</div>
							<div className="space-y-2">
								<label className="flex items-center space-x-2">
									<input
										type="radio"
										name="scope"
										value="project"
										checked={scope === "project"}
										onChange={() => setScope("project")}
										disabled={!hasWorkspace}
										className="rounded-full"
									/>
									<span className={!hasWorkspace ? "opacity-50" : ""}>
										{t("marketplace:install.project")}
									</span>
								</label>
								<label className="flex items-center space-x-2">
									<input
										type="radio"
										name="scope"
										value="global"
										checked={scope === "global"}
										onChange={() => setScope("global")}
										className="rounded-full"
									/>
									<span>{t("marketplace:install.global")}</span>
								</label>
							</div>
						</div>

						{/* Installation Method (if multiple) */}
						{hasMultipleMethods && (
							<div className="space-y-2">
								<div className="text-base font-semibold">{t("marketplace:install.method")}</div>
								<Select
									value={String(selectedMethodIndex)}
									onValueChange={(value) => setSelectedMethodIndex(Number(value))}>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{methodNames.map((name, index) => (
											<SelectItem key={index} value={String(index)}>
												{name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						)}

						{/* Prerequisites */}
						{effectivePrerequisites.length > 0 && (
							<div className="space-y-2">
								<div className="text-base font-semibold">{t("marketplace:install.prerequisites")}</div>
								<ul className="list-disc list-inside space-y-1 text-sm">
									{effectivePrerequisites.map((prereq, index) => (
										<li key={index} className="text-muted-foreground">
											{prereq}
										</li>
									))}
								</ul>
							</div>
						)}

						{/* Parameters */}
						{effectiveParameters.length > 0 && (
							<div className="space-y-3">
								<div className="space-y-1">
									<div className="text-base font-semibold">
										{t("marketplace:install.configuration")}
									</div>
									<div className="text-sm text-muted-foreground">
										{t("marketplace:install.configurationDescription")}
									</div>
								</div>
								{effectiveParameters.map((param) => (
									<div key={param.key} className="space-y-1">
										<label htmlFor={param.key} className="text-sm">
											{param.name}
											{param.optional ? " (optional)" : ""}
										</label>
										<Input
											id={param.key}
											type="text"
											placeholder={param.placeholder}
											value={parameterValues[param.key] || ""}
											onChange={(e) =>
												setParameterValues((prev) => ({
													...prev,
													[param.key]: e.target.value,
												}))
											}
										/>
									</div>
								))}
							</div>
						)}
						{/* Validation Error */}
						{validationError && (
							<div className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded p-2">
								{validationError}
							</div>
						)}
					</div>
				)}

				<DialogFooter>
					{installationComplete ? (
						<>
							<Button variant="outline" onClick={onClose}>
								{t("marketplace:install.done")}
							</Button>
							<Button onClick={() => handlePostInstallAction(item.type === "mcp" ? "mcp" : "modes")}>
								{item.type === "mcp"
									? t("marketplace:install.goToMcp")
									: t("marketplace:install.goToModes")}
							</Button>
						</>
					) : (
						<>
							<Button variant="outline" onClick={onClose}>
								{t("common:answers.cancel")}
							</Button>
							<Button onClick={handleInstall}>{t("marketplace:install.button")}</Button>
						</>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
