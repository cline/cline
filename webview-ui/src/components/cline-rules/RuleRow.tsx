import { StringRequest } from "@shared/proto/cline/common"
import { RuleFileRequest } from "@shared/proto/index.cline"
import { PenIcon, Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { FileServiceClient } from "@/services/grpc-client"

const RuleRow: React.FC<{
	rulePath: string
	enabled: boolean
	isGlobal: boolean
	ruleType: string
	toggleRule: (rulePath: string, enabled: boolean) => void
}> = ({ rulePath, enabled, isGlobal, toggleRule, ruleType }) => {
	// Check if the path type is Windows
	const win32Path = /^[a-zA-Z]:\\/.test(rulePath)
	// Get the filename from the path for display
	const displayName = rulePath.split(win32Path ? "\\" : "/").pop() || rulePath

	const getRuleTypeIcon = () => {
		switch (ruleType) {
			case "cursor":
				return (
					<svg
						height="16"
						style={{ verticalAlign: "middle" }}
						viewBox="0 0 24 24"
						width="16"
						xmlns="http://www.w3.org/2000/svg">
						<g fill="none" stroke="currentColor" strokeWidth="1.2">
							<path d="M12 4L5 8l7 4 7-4-7-4z" fill="rgba(255,255,255,0.2)" />
							<path d="M5 8v8l7 4v-8L5 8z" fill="rgba(255,255,255,0.1)" />
							<path d="M19 8v8l-7 4v-8l7-4z" fill="rgba(255,255,255,0.15)" />
							<line x1="5" x2="12" y1="8" y2="12" />
							<line x1="12" x2="19" y1="12" y2="8" />
							<line x1="12" x2="12" y1="12" y2="20" />
						</g>
					</svg>
				)
			case "windsurf":
				return (
					<svg
						height="16"
						style={{ verticalAlign: "middle" }}
						viewBox="0 0 24 24"
						width="16"
						xmlns="http://www.w3.org/2000/svg">
						<g fill="currentColor" stroke="currentColor" strokeWidth="1">
							<path d="M6 18L16 5L14 18H6z" fill="currentColor" />
							<line strokeWidth="1.5" x1="14" x2="16" y1="18" y2="5" />
							<path d="M4 19h12c0.5 0 1-0.3 1-1s-0.3-1-1-1H4c-0.5 0-1 0.3-1 1s0.3 1 1 1z" fill="currentColor" />
							<line strokeWidth="1" x1="14" x2="16" y1="13" y2="9" />
						</g>
					</svg>
				)
			default:
				return null
		}
	}

	const handleEditClick = () => {
		FileServiceClient.openFile(StringRequest.create({ value: rulePath })).catch((err) =>
			console.error("Failed to open file:", err),
		)
	}

	const handleDeleteClick = () => {
		FileServiceClient.deleteRuleFile(
			RuleFileRequest.create({
				rulePath,
				isGlobal,
				type: ruleType || "cline",
			}),
		).catch((err) => console.error("Failed to delete rule file:", err))
	}

	return (
		<div className="mb-2.5">
			<div
				className={`flex items-center p-2 py-4 rounded bg-(--vscode-textCodeBlock-background) h-[18px] ${
					enabled ? "opacity-100" : "opacity-60"
				}`}>
				<span className="flex-1 overflow-hidden break-all whitespace-normal flex items-center mr-1" title={rulePath}>
					{getRuleTypeIcon() && <span className="mr-1.5">{getRuleTypeIcon()}</span>}
					<span className="ph-no-capture">{displayName}</span>
				</span>

				{/* Toggle Switch */}
				<div className="flex items-center ml-2 space-x-2">
					<Switch checked={enabled} key={rulePath} onClick={() => toggleRule(rulePath, !enabled)} />
					<Button aria-label="Edit rule file" onClick={handleEditClick} size="sm" title="Edit rule file" variant="icon">
						<PenIcon />
					</Button>
					<Button
						aria-label="Delete rule file"
						onClick={handleDeleteClick}
						size="sm"
						title="Delete rule file"
						variant="icon">
						<Trash2Icon />
					</Button>
				</div>
			</div>
		</div>
	)
}

export default RuleRow
