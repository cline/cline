import { VSCodeBadge, VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "../context/ExtensionStateContext"
import { vscode } from "../utils/vscode"

type HistoryPreviewProps = {
	showHistoryView: () => void
}

const HistoryPreview = ({ showHistoryView }: HistoryPreviewProps) => {
	const { taskHistory } = useExtensionState()
	const handleHistorySelect = (id: string) => {
		vscode.postMessage({ type: "showTaskWithId", text: id })
	}

	const formatDate = (timestamp: number) => {
		const date = new Date(timestamp)
		return date
			?.toLocaleString("en-US", {
				month: "long",
				day: "numeric",
				hour: "numeric",
				minute: "2-digit",
				hour12: true,
			})
			.replace(", ", " ")
			.replace(" at", ",")
	}

	return (
		<section>
			<h3 className="flex-line uppercase text-alt">
				<span className="codicon codicon-history text-alt" />
				Recent Tasks
			</h3>

			{taskHistory
				.filter((item) => item.ts && item.task)
				.slice(0, 3)
				.map((item) => (
					<div key={item.id} className="task-card is-clickable" onClick={() => handleHistorySelect(item.id)}>
						<div
							style={{
								display: "-webkit-box",
								WebkitLineClamp: 3,
								WebkitBoxOrient: "vertical",
								overflow: "hidden",
								whiteSpace: "pre-wrap",
								wordBreak: "break-word",
								overflowWrap: "anywhere",
							}}>
							{item.task}
						</div>
						<div className="text-light">{formatDate(item.ts)}</div>
						<div className="text-light flex-line wrap" style={{ justifyContent: "space-between" }}>
							<div className="flex-line nowrap">
								Tokens:
								<code>
									<span>↑</span>
									{item.tokensIn?.toLocaleString()}
								</code>
								<code>
									<span>↓</span>
									{item.tokensOut?.toLocaleString()}
								</code>
							</div>
							{item.cacheWrites && item.cacheReads && (
								<div className="flex-line nowrap">
									Cache:
									<code>
										<span>+</span>
										{item.cacheWrites?.toLocaleString()}
									</code>
									<code>
										<span>→</span>
										{item.cacheReads?.toLocaleString()}
									</code>
								</div>
							)}
							<div className="flex-line nowrap">
								API Cost:
								<code>
									<span>$</span>
									{item.totalCost?.toFixed(4)}
								</code>
							</div>
						</div>
					</div>
				))}
			<VSCodeButton appearance="icon" onClick={() => showHistoryView()}>
				<div className="text-light">View all history</div>
			</VSCodeButton>
		</section>
	)
}

export default HistoryPreview
