import { VSCodeButton, VSCodeDropdown, VSCodeOption, VSCodeLink, VSCodeCheckbox, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { memo, useEffect, useState, useCallback, useRef } from "react"
import { NumericFormat } from "react-number-format"
import { vscode } from "../../utils/vscode"
import type { CheckpointSettings } from "../../../../src/shared/WebviewMessage"
import debounce from "debounce"

const fileSizeOptions = [
	{ value: "5", text: "5MB" },
	{ value: "10", text: "10MB" },
	{ value: "25", text: "25MB" },
	{ value: "50", text: "50MB" },
	{ value: "100", text: "100MB" },
	{ value: "-1", text: "No Limit" },
	{ value: "custom", text: "Custom" },
]

const CheckpointsSettingsView = () => {
	const [settings, setSettings] = useState<CheckpointSettings>({
		fileSizeThresholdMB: 5,
		enableCheckpoints: true,
	})
	const [isCustomSize, setIsCustomSize] = useState(false)
	const [customSizeValue, setCustomSizeValue] = useState("")
	const customSizeInputRef = useRef<HTMLInputElement>(null)

	// Create debounced update function
	const debouncedUpdateSettings = useCallback(
		debounce((value: number) => {
			const newSettings = {
				...settings,
				fileSizeThresholdMB: value,
			}
			setSettings(newSettings)
			vscode.postMessage({
				type: "updateCheckpointSettings",
				checkpointSettings: newSettings,
			})
		}, 1000),
		[settings]
	)

	useEffect(() => {
		// Get initial settings
		vscode.postMessage({
			type: "getCheckpointSettings",
		})
	}, [])

	useEffect(() => {
		const messageHandler = (event: MessageEvent) => {
			const message = event.data
			switch (message.type) {
				case "checkpointSettings": {
					const newSettings = message.checkpointSettings
					setSettings(newSettings)
					
					// Check if current value matches any preset
					const isPresetValue = fileSizeOptions.some(
						option => option.value !== "custom" && parseFloat(option.value) === newSettings.fileSizeThresholdMB
					)
					
					if (!isPresetValue) {
						setIsCustomSize(true)
						setCustomSizeValue(newSettings.fileSizeThresholdMB.toString())
					}
					break
				}
			}
		}

		window.addEventListener("message", messageHandler)
		return () => window.removeEventListener("message", messageHandler)
	}, [])

	const handleFileSizeChange = (e: any) => {
		const select = e.target as HTMLSelectElement
		const value = select.value
		
		if (value === "custom") {
			setIsCustomSize(true)
			setCustomSizeValue(settings.fileSizeThresholdMB.toString())
			setTimeout(() => {
				if (customSizeInputRef.current) {
					customSizeInputRef.current.focus()
				}
			}, 0)
		} else {
			setIsCustomSize(false)
			const newValue = parseFloat(value)
			const newSettings = {
				...settings,
				fileSizeThresholdMB: newValue,
			}
			setSettings(newSettings)
			vscode.postMessage({
				type: "updateCheckpointSettings",
				checkpointSettings: newSettings,
			})
		}
	}

	const handleEnableChange = (e: any) => {
		const checkbox = e.target as HTMLInputElement
		const newSettings = {
			...settings,
			enableCheckpoints: checkbox.checked,
		}
		setSettings(newSettings)
		vscode.postMessage({
			type: "updateCheckpointSettings",
			checkpointSettings: newSettings,
		})
	}

	const handleDeleteCheckpoints = () => {
		vscode.postMessage({
			type: "confirmDeleteAllCheckpoints",
		})
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
			<div>
				<div style={{ fontWeight: "500", marginBottom: "8px" }}>Enable Checkpoints</div>
				<VSCodeCheckbox checked={settings.enableCheckpoints} onChange={handleEnableChange}>
					Enable checkpoints
				</VSCodeCheckbox>
				<p
					style={{
						fontSize: "12px",
						marginTop: "5px",
						color: "var(--vscode-descriptionForeground)",
					}}>
					Automatically create checkpoints when Cline makes changes to your files
				</p>
			</div>

			<div>
				<div style={{ fontWeight: "500", marginBottom: "8px" }}>File Size Threshold</div>
				<div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
					{isCustomSize && (
						<NumericFormat
							customInput={VSCodeTextField}
							getInputRef={customSizeInputRef}
							value={customSizeValue}
							onValueChange={({ value }) => {
								setCustomSizeValue(value)
								if (value !== "") {
									debouncedUpdateSettings(parseFloat(value))
								}
							}}
							allowNegative={customSizeValue === "-1"}
							decimalScale={3}
							placeholder="Size in MB"
							style={{ width: "120px" }}
						/>
					)}
					<VSCodeDropdown 
						value={isCustomSize ? "custom" : `${settings.fileSizeThresholdMB}`} 
						onChange={handleFileSizeChange}
					>
						{fileSizeOptions.map((option) => (
							<VSCodeOption key={option.value} value={option.value}>
								{option.text}
							</VSCodeOption>
						))}
					</VSCodeDropdown>
				</div>
				<p
					style={{
						fontSize: "12px",
						marginTop: "5px",
						color: "var(--vscode-descriptionForeground)",
					}}>
					Exclude files larger than this size in MB from checkpoint creation globally
				</p>
			</div>

			<div>
				<div style={{ fontWeight: "500", marginBottom: "8px" }}>Checkpoints File Exclusions</div>
				<VSCodeLink onClick={() => vscode.postMessage({ type: "openCheckpointsIgnore" })}>
					Edit .checkpointsignore
				</VSCodeLink>
				<p
					style={{
						fontSize: "12px",
						marginTop: "5px",
						color: "var(--vscode-descriptionForeground)",
					}}>
					Configure which files and directories to exclude from checkpoint creation globally
				</p>
			</div>

			<div>
				<div style={{ fontWeight: "500", marginBottom: "8px" }}>Delete All Checkpoints</div>
				<VSCodeButton onClick={handleDeleteCheckpoints}>
					<i className="codicon codicon-trash" style={{ marginRight: "6px" }} />
					Delete All
				</VSCodeButton>
				<p
					style={{
						fontSize: "12px",
						marginTop: "5px",
						color: "var(--vscode-descriptionForeground)",
					}}>
					Permanently remove all saved checkpoints from your system
				</p>
			</div>
		</div>
	)
}

export default memo(CheckpointsSettingsView)
