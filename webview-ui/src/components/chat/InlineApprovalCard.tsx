import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface InlineApprovalCardProps {
	toolName: string
	toolDescription?: string
	approvalPolicy: "ask_everytime" | "auto_approve" | "never_allow"
	onApprove: () => void
	onReject: () => void
	onPolicyChange: (toolName: string, policy: "ask_everytime" | "auto_approve" | "never_allow") => void
	isEnabled: boolean
	showDetails?: boolean
	onToggleDetails?: () => void
	approveButtonLabel?: string
}

export const InlineApprovalCard: React.FC<InlineApprovalCardProps> = ({
	toolName,
	toolDescription,
	approvalPolicy,
	onApprove,
	onReject,
	onPolicyChange,
	isEnabled,
	showDetails = false,
	onToggleDetails,
	approveButtonLabel = "Run",
}) => {
	const policyLabels = {
		ask_everytime: "Ask Everytime",
		auto_approve: "Auto-approve",
		never_allow: "Never allow",
	}

	return (
		<div className="inline-approval-card bg-code border-x border-b border-editor-group-border rounded-b-sm overflow-hidden">
			{/* Approval Actions */}
			<div className="flex items-center gap-2 py-2 px-2.5">
				{/* Policy Select */}
				<Select
					disabled={!isEnabled}
					onValueChange={(policy) => onPolicyChange(toolName, policy as any)}
					value={approvalPolicy}>
					<SelectTrigger className="w-auto items-center [&_span]:-mt-px border-0" size="sm">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="ask_everytime">{policyLabels.ask_everytime}</SelectItem>
						<SelectItem value="auto_approve">{policyLabels.auto_approve}</SelectItem>
						<SelectItem value="never_allow">{policyLabels.never_allow}</SelectItem>
					</SelectContent>
				</Select>

				{/* Spacer */}
				<div className="flex-1" />

				{/* Action Buttons */}
				<button
					className="text-foreground hover:text-link text-sm cursor-pointer border-0 bg-transparent px-2 py-[.2rem] disabled:opacity-50 disabled:cursor-not-allowed"
					disabled={!isEnabled}
					onClick={onReject}>
					Cancel
				</button>
				<button
					className="bg-button-background text-button-foreground hover:bg-button-hover border-0 rounded-sm text-sm cursor-pointer px-2 py-[.2rem] disabled:opacity-50 disabled:cursor-not-allowed"
					disabled={!isEnabled}
					onClick={onApprove}>
					{approveButtonLabel}
				</button>
			</div>

			{/* Optional Description */}
			{toolDescription && showDetails && (
				<div className="py-2 px-2.5 border-t border-editor-group-border text-sm text-muted-foreground">
					{toolDescription}
				</div>
			)}
		</div>
	)
}
