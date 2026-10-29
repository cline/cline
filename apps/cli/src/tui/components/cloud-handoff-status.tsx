import { useKeyboard } from "@opentui/react";
import type { CloudHandoffDraft } from "../../runtime/interactive/cloud-handoff";
import open from "../../utils/open";
import type { CloudHandoffStatus } from "../hooks/use-cloud-handoff";

const modifierLabel = process.platform === "darwin" ? "Option" : "Alt";

export function CloudHandoffStatusBar(props: {
	status: CloudHandoffStatus;
	disabled: boolean;
	onOpen: (sessionId: string) => Promise<void>;
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
				: (status.result.warning ??
					"Cloud task ready. You can keep working locally.");
	const openLink = () => {
		if (!props.disabled && url) void open(url, { wait: false }).catch(() => {});
	};
	const openInTui = () => {
		if (!props.disabled && status.kind === "complete")
			void props.onOpen(status.result.sessionId);
	};
	useKeyboard((key) => {
		if (props.disabled || !key.meta || key.ctrl || key.shift) return;
		if (key.name === "o" && status.kind === "complete") {
			key.preventDefault();
			openInTui();
		} else if (key.name === "o" && status.kind === "failed" && url) {
			key.preventDefault();
			openLink();
		} else if (key.name === "e" && status.kind === "failed") {
			key.preventDefault();
			props.onRestore(status.draft);
		} else if (
			key.name === "e" &&
			status.kind === "complete" &&
			status.result.retrySend
		) {
			key.preventDefault();
			void props.onRetry();
		} else if (key.name === "d" && status.kind !== "progress") {
			key.preventDefault();
			props.onDismiss();
		}
	});
	return (
		<box flexDirection="column" paddingX={1} flexShrink={0}>
			<text fg={status.kind === "failed" ? "red" : "cyan"}>
				Cloud handoff: {message}
			</text>
			{status.kind === "complete" && (
				<box onMouseDown={openInTui}>
					<text>Open in TUI ({modifierLabel}+O)</text>
				</box>
			)}
			{url && (
				<box onMouseDown={openLink}>
					<text>
						<a href={url}>
							{status.kind === "failed"
								? `Connect GitHub (${modifierLabel}+O)`
								: "Open in browser"}
							: {url}
						</a>
					</text>
				</box>
			)}
			{status.kind !== "progress" && (
				<box flexDirection="row" gap={2}>
					{status.kind === "failed" && (
						<box onMouseDown={() => props.onRestore(status.draft)}>
							<text>Restore /cloud draft ({modifierLabel}+E)</text>
						</box>
					)}
					{status.kind === "complete" && status.result.retrySend && (
						<box
							onMouseDown={() => {
								void props.onRetry();
							}}
						>
							<text>Retry saved prompt ({modifierLabel}+E)</text>
						</box>
					)}
					<box onMouseDown={props.onDismiss}>
						<text fg="gray">Dismiss ({modifierLabel}+D)</text>
					</box>
				</box>
			)}
		</box>
	);
}
