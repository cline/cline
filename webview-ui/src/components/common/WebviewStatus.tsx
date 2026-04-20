import { Button } from "@/components/ui/button"

interface WebviewStatusProps {
	title: string
	description: string
	details?: string
	isLoading?: boolean
	onRetry?: () => void
	onReload?: () => void
	retryLabel?: string
}

export const WebviewStatus = ({
	title,
	description,
	details,
	isLoading = false,
	onRetry,
	onReload,
	retryLabel = "Retry connection",
}: WebviewStatusProps) => {
	return (
		<div className="flex h-screen w-full items-center justify-center bg-background text-foreground">
			<div className="mx-4 flex w-full max-w-xl flex-col gap-3 rounded-lg border border-border bg-background p-5 shadow-sm">
				<div className="flex items-center gap-2 text-base font-semibold">
					{isLoading ? (
						<i className="codicon codicon-loading codicon-modifier-spin text-link" />
					) : (
						<i className="codicon codicon-warning text-link" />
					)}
					<span>{title}</span>
				</div>
				<p className="m-0 text-sm text-[var(--vscode-descriptionForeground)]">{description}</p>
				{details ? (
					<pre className="m-0 overflow-auto rounded-md border border-border bg-code p-3 text-xs whitespace-pre-wrap text-[var(--vscode-descriptionForeground)]">
						{details}
					</pre>
				) : null}
				<div className="flex flex-wrap gap-2 pt-1">
					{onRetry ? (
						<Button onClick={onRetry} size="sm">
							{retryLabel}
						</Button>
					) : null}
					{onReload ? (
						<Button onClick={onReload} size="sm" variant="secondary">
							Reload webview
						</Button>
					) : null}
				</div>
			</div>
		</div>
	)
}

export default WebviewStatus
