import type { CloudHandoffDraft } from "../../runtime/interactive/cloud-handoff";
import open from "../../utils/open";
import type { CloudHandoffStatus } from "../hooks/use-cloud-handoff";

export function CloudHandoffStatusBar(props: {
	status: CloudHandoffStatus;
	disabled: boolean;
	onOpen: () => Promise<void>;
	onDismiss: () => void;
	onRetry: () => Promise<void>;
	onRestore: (draft: CloudHandoffDraft) => void;
}) {
	const { status } = props;
	const url =
		status.kind === "complete"
			? status.result.dashboardUrl
			: status.kind === "progress"
				? status.progress.dashboardUrl
				: status.connectUrl;
	const message =
		status.kind === "progress"
			? status.progress.message
			: status.kind === "failed"
				? status.message
				: status.result.warning;
	const openLink = () => {
		if (!props.disabled && url) void open(url, { wait: false }).catch(() => {});
	};
	const openInTui = () => {
		if (!props.disabled && status.kind === "complete") void props.onOpen();
	};
	return (
		<box flexDirection="column" paddingX={1} flexShrink={0}>
			{message && (
				<text fg={status.kind === "failed" ? "red" : "cyan"}>
					Cloud handoff: {message}
				</text>
			)}
			<box flexDirection="row" flexWrap="wrap" gap={2}>
				{status.kind === "complete" && (
					<>
						{!message && <text fg="cyan">Cloud ready</text>}
						<text onMouseDown={openInTui}>Open in TUI (Ctrl+O)</text>
					</>
				)}
				{url && (
					<text onMouseDown={openLink}>
						<a href={url}>
							{status.kind === "failed" ? "Connect GitHub" : "Browser"}
						</a>
					</text>
				)}
				{status.kind !== "progress" && (
					<>
						{status.kind === "failed" && (
							<text
								onMouseDown={() => {
									if (!props.disabled) props.onRestore(status.draft);
								}}
							>
								Restore draft
							</text>
						)}
						{status.kind === "complete" && status.result.retrySend && (
							<text
								onMouseDown={() => {
									if (!props.disabled) void props.onRetry();
								}}
							>
								Retry prompt
							</text>
						)}
						<text
							fg="gray"
							onMouseDown={() => {
								if (!props.disabled) props.onDismiss();
							}}
						>
							Dismiss
						</text>
					</>
				)}
			</box>
		</box>
	);
}
