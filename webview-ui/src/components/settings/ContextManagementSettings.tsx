import { HTMLAttributes } from "react"
import React from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { Database, FoldVertical } from "lucide-react"

import { cn } from "@/lib/utils"
import { Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Slider, Button } from "@/components/ui"

import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { vscode } from "@/utils/vscode"

type ContextManagementSettingsProps = HTMLAttributes<HTMLDivElement> & {
	autoCondenseContext: boolean
	autoCondenseContextPercent: number
	listApiConfigMeta: any[]
	maxOpenTabsContext: number
	maxWorkspaceFiles: number
	showRooIgnoredFiles?: boolean
	maxReadFileLine?: number
	maxImageFileSize?: number
	maxTotalImageSize?: number
	maxConcurrentFileReads?: number
	profileThresholds?: Record<string, number>
	includeDiagnosticMessages?: boolean
	maxDiagnosticMessages?: number
	writeDelayMs: number
	setCachedStateField: SetCachedStateField<
		| "autoCondenseContext"
		| "autoCondenseContextPercent"
		| "maxOpenTabsContext"
		| "maxWorkspaceFiles"
		| "showRooIgnoredFiles"
		| "maxReadFileLine"
		| "maxImageFileSize"
		| "maxTotalImageSize"
		| "maxConcurrentFileReads"
		| "profileThresholds"
		| "includeDiagnosticMessages"
		| "maxDiagnosticMessages"
		| "writeDelayMs"
	>
}

export const ContextManagementSettings = ({
	autoCondenseContext,
	autoCondenseContextPercent,
	listApiConfigMeta,
	maxOpenTabsContext,
	maxWorkspaceFiles,
	showRooIgnoredFiles,
	setCachedStateField,
	maxReadFileLine,
	maxImageFileSize,
	maxTotalImageSize,
	maxConcurrentFileReads,
	profileThresholds = {},
	includeDiagnosticMessages,
	maxDiagnosticMessages,
	writeDelayMs,
	className,
	...props
}: ContextManagementSettingsProps) => {
	const { t } = useAppTranslation()
	const [selectedThresholdProfile, setSelectedThresholdProfile] = React.useState<string>("default")

	// Helper function to get the current threshold value based on selected profile
	const getCurrentThresholdValue = () => {
		if (selectedThresholdProfile === "default") {
			return autoCondenseContextPercent
		}
		const profileThreshold = profileThresholds[selectedThresholdProfile]
		if (profileThreshold === undefined || profileThreshold === -1) {
			return autoCondenseContextPercent // Use default if profile not configured or set to -1
		}
		return profileThreshold
	}

	// Helper function to handle threshold changes
	const handleThresholdChange = (value: number) => {
		if (selectedThresholdProfile === "default") {
			setCachedStateField("autoCondenseContextPercent", value)
		} else {
			const newThresholds = {
				...profileThresholds,
				[selectedThresholdProfile]: value,
			}
			setCachedStateField("profileThresholds", newThresholds)
			vscode.postMessage({
				type: "profileThresholds",
				values: newThresholds,
			})
		}
	}
	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			<SectionHeader description={t("settings:contextManagement.description")}>
				<div className="flex items-center gap-2">
					<Database className="w-4" />
					<div>{t("settings:sections.contextManagement")}</div>
				</div>
			</SectionHeader>

			<Section>
				<div>
					<span className="block font-medium mb-1">{t("settings:contextManagement.openTabs.label")}</span>
					<div className="flex items-center gap-2">
						<Slider
							min={0}
							max={500}
							step={1}
							value={[maxOpenTabsContext ?? 20]}
							onValueChange={([value]) => setCachedStateField("maxOpenTabsContext", value)}
							data-testid="open-tabs-limit-slider"
						/>
						<span className="w-10">{maxOpenTabsContext ?? 20}</span>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:contextManagement.openTabs.description")}
					</div>
				</div>

				<div>
					<span className="block font-medium mb-1">
						{t("settings:contextManagement.workspaceFiles.label")}
					</span>
					<div className="flex items-center gap-2">
						<Slider
							min={0}
							max={500}
							step={1}
							value={[maxWorkspaceFiles ?? 200]}
							onValueChange={([value]) => setCachedStateField("maxWorkspaceFiles", value)}
							data-testid="workspace-files-limit-slider"
						/>
						<span className="w-10">{maxWorkspaceFiles ?? 200}</span>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:contextManagement.workspaceFiles.description")}
					</div>
				</div>

				<div>
					<span className="block font-medium mb-1">
						{t("settings:contextManagement.maxConcurrentFileReads.label")}
					</span>
					<div className="flex items-center gap-2">
						<Slider
							min={1}
							max={100}
							step={1}
							value={[Math.max(1, maxConcurrentFileReads ?? 5)]}
							onValueChange={([value]) => setCachedStateField("maxConcurrentFileReads", value)}
							data-testid="max-concurrent-file-reads-slider"
						/>
						<span className="w-10 text-sm">{Math.max(1, maxConcurrentFileReads ?? 5)}</span>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-1 mb-3">
						{t("settings:contextManagement.maxConcurrentFileReads.description")}
					</div>
				</div>

				<div>
					<VSCodeCheckbox
						checked={showRooIgnoredFiles}
						onChange={(e: any) => setCachedStateField("showRooIgnoredFiles", e.target.checked)}
						data-testid="show-rooignored-files-checkbox">
						<label className="block font-medium mb-1">
							{t("settings:contextManagement.rooignore.label")}
						</label>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1 mb-3">
						{t("settings:contextManagement.rooignore.description")}
					</div>
				</div>

				<div>
					<div className="flex flex-col gap-2">
						<span className="font-medium">{t("settings:contextManagement.maxReadFile.label")}</span>
						<div className="flex items-center gap-4">
							<Input
								type="number"
								pattern="-?[0-9]*"
								className="w-24 bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border px-2 py-1 rounded text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none disabled:opacity-50"
								value={maxReadFileLine ?? -1}
								min={-1}
								onChange={(e) => {
									const newValue = parseInt(e.target.value, 10)
									if (!isNaN(newValue) && newValue >= -1) {
										setCachedStateField("maxReadFileLine", newValue)
									}
								}}
								onClick={(e) => e.currentTarget.select()}
								data-testid="max-read-file-line-input"
								disabled={maxReadFileLine === -1}
							/>
							<span>{t("settings:contextManagement.maxReadFile.lines")}</span>
							<VSCodeCheckbox
								checked={maxReadFileLine === -1}
								onChange={(e: any) =>
									setCachedStateField("maxReadFileLine", e.target.checked ? -1 : 500)
								}
								data-testid="max-read-file-always-full-checkbox">
								{t("settings:contextManagement.maxReadFile.always_full_read")}
							</VSCodeCheckbox>
						</div>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-2">
						{t("settings:contextManagement.maxReadFile.description")}
					</div>
				</div>

				<div>
					<div className="flex flex-col gap-2">
						<span className="font-medium">{t("settings:contextManagement.maxImageFileSize.label")}</span>
						<div className="flex items-center gap-4">
							<Input
								type="number"
								pattern="[0-9]*"
								className="w-24 bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border px-2 py-1 rounded text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
								value={maxImageFileSize ?? 5}
								min={1}
								max={100}
								onChange={(e) => {
									const newValue = parseInt(e.target.value, 10)
									if (!isNaN(newValue) && newValue >= 1 && newValue <= 100) {
										setCachedStateField("maxImageFileSize", newValue)
									}
								}}
								onClick={(e) => e.currentTarget.select()}
								data-testid="max-image-file-size-input"
							/>
							<span>{t("settings:contextManagement.maxImageFileSize.mb")}</span>
						</div>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-2">
						{t("settings:contextManagement.maxImageFileSize.description")}
					</div>
				</div>

				<div>
					<div className="flex flex-col gap-2">
						<span className="font-medium">{t("settings:contextManagement.maxTotalImageSize.label")}</span>
						<div className="flex items-center gap-4">
							<Input
								type="number"
								pattern="[0-9]*"
								className="w-24 bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border px-2 py-1 rounded text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
								value={maxTotalImageSize ?? 20}
								min={1}
								max={500}
								onChange={(e) => {
									const newValue = parseInt(e.target.value, 10)
									if (!isNaN(newValue) && newValue >= 1 && newValue <= 500) {
										setCachedStateField("maxTotalImageSize", newValue)
									}
								}}
								onClick={(e) => e.currentTarget.select()}
								data-testid="max-total-image-size-input"
							/>
							<span>{t("settings:contextManagement.maxTotalImageSize.mb")}</span>
						</div>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-2">
						{t("settings:contextManagement.maxTotalImageSize.description")}
					</div>
				</div>

				<div>
					<VSCodeCheckbox
						checked={includeDiagnosticMessages}
						onChange={(e: any) => setCachedStateField("includeDiagnosticMessages", e.target.checked)}
						data-testid="include-diagnostic-messages-checkbox">
						<label className="block font-medium mb-1">
							{t("settings:contextManagement.diagnostics.includeMessages.label")}
						</label>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1 mb-3">
						{t("settings:contextManagement.diagnostics.includeMessages.description")}
					</div>
				</div>

				<div>
					<span className="block font-medium mb-1">
						{t("settings:contextManagement.diagnostics.maxMessages.label")}
					</span>
					<div className="flex items-center gap-2">
						<Slider
							min={1}
							max={100}
							step={1}
							value={[
								maxDiagnosticMessages !== undefined && maxDiagnosticMessages <= 0
									? 100
									: (maxDiagnosticMessages ?? 50),
							]}
							onValueChange={([value]) => {
								// When slider reaches 100, set to -1 (unlimited)
								setCachedStateField("maxDiagnosticMessages", value === 100 ? -1 : value)
							}}
							data-testid="max-diagnostic-messages-slider"
							aria-label={t("settings:contextManagement.diagnostics.maxMessages.label")}
							aria-valuemin={1}
							aria-valuemax={100}
							aria-valuenow={
								maxDiagnosticMessages !== undefined && maxDiagnosticMessages <= 0
									? 100
									: (maxDiagnosticMessages ?? 50)
							}
							aria-valuetext={
								(maxDiagnosticMessages !== undefined && maxDiagnosticMessages <= 0) ||
								maxDiagnosticMessages === 100
									? t("settings:contextManagement.diagnostics.maxMessages.unlimitedLabel")
									: `${maxDiagnosticMessages ?? 50} ${t("settings:contextManagement.diagnostics.maxMessages.label")}`
							}
						/>
						<span className="w-20 text-sm font-medium">
							{(maxDiagnosticMessages !== undefined && maxDiagnosticMessages <= 0) ||
							maxDiagnosticMessages === 100
								? t("settings:contextManagement.diagnostics.maxMessages.unlimitedLabel")
								: (maxDiagnosticMessages ?? 50)}
						</span>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setCachedStateField("maxDiagnosticMessages", 50)}
							title={t("settings:contextManagement.diagnostics.maxMessages.resetTooltip")}
							className="p-1 h-6 w-6"
							disabled={maxDiagnosticMessages === 50}>
							<span className="codicon codicon-discard" />
						</Button>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:contextManagement.diagnostics.maxMessages.description")}
					</div>
				</div>

				<div>
					<span className="block font-medium mb-1">
						{t("settings:contextManagement.diagnostics.delayAfterWrite.label")}
					</span>
					<div className="flex items-center gap-2">
						<Slider
							min={0}
							max={5000}
							step={100}
							value={[writeDelayMs]}
							onValueChange={([value]) => setCachedStateField("writeDelayMs", value)}
							data-testid="write-delay-slider"
						/>
						<span className="w-20">{writeDelayMs}ms</span>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:contextManagement.diagnostics.delayAfterWrite.description")}
					</div>
				</div>
			</Section>
			<Section className="pt-2">
				<VSCodeCheckbox
					checked={autoCondenseContext}
					onChange={(e: any) => setCachedStateField("autoCondenseContext", e.target.checked)}
					data-testid="auto-condense-context-checkbox">
					<span className="font-medium">{t("settings:contextManagement.autoCondenseContext.name")}</span>
				</VSCodeCheckbox>
				{autoCondenseContext && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						<div className="flex items-center gap-4 font-bold">
							<FoldVertical size={16} />
							<div>{t("settings:contextManagement.condensingThreshold.label")}</div>
						</div>
						<div>
							<Select
								value={selectedThresholdProfile || "default"}
								onValueChange={(value) => {
									setSelectedThresholdProfile(value)
								}}
								data-testid="threshold-profile-select">
								<SelectTrigger className="w-full">
									<SelectValue
										placeholder={
											t("settings:contextManagement.condensingThreshold.selectProfile") ||
											"Select profile for threshold"
										}
									/>
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="default">
										{t("settings:contextManagement.condensingThreshold.defaultProfile") ||
											"Default (applies to all unconfigured profiles)"}
									</SelectItem>
									{(listApiConfigMeta || []).map((config) => {
										const profileThreshold = profileThresholds[config.id]
										const thresholdDisplay =
											profileThreshold !== undefined
												? profileThreshold === -1
													? ` ${t(
															"settings:contextManagement.condensingThreshold.usesGlobal",
															{
																threshold: autoCondenseContextPercent,
															},
														)}`
													: ` (${profileThreshold}%)`
												: ""
										return (
											<SelectItem key={config.id} value={config.id}>
												{config.name}
												{thresholdDisplay}
											</SelectItem>
										)
									})}
								</SelectContent>
							</Select>
						</div>

						{/* Threshold Slider */}
						<div>
							<div className="flex items-center gap-2">
								<Slider
									min={10}
									max={100}
									step={1}
									value={[getCurrentThresholdValue()]}
									onValueChange={([value]) => handleThresholdChange(value)}
									data-testid="condense-threshold-slider"
								/>
								<span className="w-20">{getCurrentThresholdValue()}%</span>
							</div>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{selectedThresholdProfile === "default"
									? t("settings:contextManagement.condensingThreshold.defaultDescription", {
											threshold: autoCondenseContextPercent,
										})
									: t("settings:contextManagement.condensingThreshold.profileDescription")}
							</div>
						</div>
					</div>
				)}
			</Section>
		</div>
	)
}
