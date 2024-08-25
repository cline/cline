import React from "react"
import { getKoduSignInUrl } from "../../../src/shared/kodu"
import { vscode } from "../utils/vscode"

interface KoduPromoProps {
	vscodeUriScheme?: string
	style?: React.CSSProperties
}

const KoduPromo: React.FC<KoduPromoProps> = ({ vscodeUriScheme, style }) => {
	function onClose() {
		vscode.postMessage({ type: "didDismissKoduPromo" })
	}

	return (
		<div style={{ ...style }}>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)",
					color: "var(--vscode-textLink-foreground)",
					padding: "6px 8px",
					borderRadius: "3px",
					margin: "0 0 8px 0px",
					fontSize: "12px",
					cursor: "pointer",
				}}>
				<a
					href={getKoduSignInUrl(vscodeUriScheme)}
					style={{
						textDecoration: "none",
						color: "inherit",
						outline: "none",
						display: "flex",
						alignItems: "center",
					}}>
					<i
						className="codicon codicon-info"
						style={{
							marginRight: 6,
							fontSize: 16,
						}}></i>
					<span>Claim $20 free credits from Kodu</span>
				</a>
				<button
					onClick={onClose}
					style={{
						background: "none",
						border: "none",
						color: "var(--vscode-textLink-foreground)",
						cursor: "pointer",
						fontSize: "12px",
						opacity: 0.7,
						padding: 0,
						marginLeft: 4,
						marginTop: 2,
					}}
					onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
					onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.7")}>
					<i className="codicon codicon-close"></i>
				</button>
			</div>
		</div>
	)
}

export default KoduPromo
