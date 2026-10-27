import type { HandoffGitPreview } from "@cline/core/cloud";
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";

export function CloudHandoffConfirmContent(
	props: ChoiceContext<boolean> & { plan: HandoffGitPreview },
) {
	useDialogKeyboard((key) => {
		if (key.name === "return" || key.name === "y") props.resolve(true);
		else if (key.name === "escape" || key.name === "n") props.dismiss();
	}, props.dialogId);
	const { plan } = props;
	return (
		<box flexDirection="column" paddingX={1}>
			<text>Continue in cloud?</text>
			<text fg="gray" marginTop={1}>
				Cline will push a snapshot to a new GitHub branch and start a cloud task
				with a summary of this conversation. Later messages and edits stay
				local.
			</text>
			<text marginTop={1}>
				Repository: {plan.repoUrl} ({plan.remote})
			</text>
			<text>New branch: {plan.branch}</text>
			<text>Current branch: {plan.sourceBranch}</text>
			<text marginTop={1}>
				{plan.files.length} changed/new files · {plan.commits.length}{" "}
				unpublished commits
			</text>
			<scrollbox maxHeight={10} marginTop={1}>
				{plan.files.map((file) => (
					<text key={file.path}>
						{file.status} {file.path}
					</text>
				))}
				{plan.commits.map((commit) => (
					<text key={commit}>{commit}</text>
				))}
			</scrollbox>
			<text fg="gray" marginTop={1}>
				Ignored files are excluded. Snapshot commits are unsigned and skip
				commit hooks. Pre-push hooks run locally and may change your files.
			</text>
			<text marginTop={1}>
				<em>Y/Enter to push and continue, N/Esc to cancel</em>
			</text>
		</box>
	);
}
