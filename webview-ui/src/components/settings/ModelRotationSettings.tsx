import React, { useState } from "react"
import { Switch, Link } from "@mui/material"
import { vscode } from "../../utils/vscode"

interface KeyInfo {
	model: string
	provider: string
	lastUsed: Date
}

const ModelRotationSettings = () => {
	const [rotationEnabled, setRotationEnabled] = useState(false)
	const [currentKeyInfo, setCurrentKeyInfo] = useState<KeyInfo | null>(null)

	const handleToggle = () => {
		setRotationEnabled(!rotationEnabled)
		// TODO: Implement rotation logic
	}

	return (
		<div className="model-rotation-settings">
			<div className="setting-item">
				<span>Enable Model Rotation</span>
				<Switch checked={rotationEnabled} onChange={handleToggle} color="primary" />
			</div>

			<div className="setting-item">
				<Link
					component="button"
					variant="body2"
					onClick={() => {
						vscode.postMessage({
							type: "openFile",
							text: "/Users/julio/Repos/Autodevs/cline/model-rotation.cline",
						})
					}}>
					Open Configuration File
				</Link>
			</div>

			{rotationEnabled && currentKeyInfo && (
				<div className="current-key-info">
					<h4>Current Key Information</h4>
					<p>Model: {currentKeyInfo.model}</p>
					<p>Provider: {currentKeyInfo.provider}</p>
					<p>Last Used: {currentKeyInfo.lastUsed.toLocaleString()}</p>
				</div>
			)}
		</div>
	)
}

export default ModelRotationSettings
