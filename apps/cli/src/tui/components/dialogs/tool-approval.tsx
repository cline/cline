import type { ToolApprovalRequest } from "@cline/shared";
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";
import type React from "react";
import { palette } from "../../palette";
import {
	parseApplyPatchInput,
	parseEditorInput,
	parseReadFilesInput,
	parseRunCommandsInput,
	parseSearchInput,
	parseSpawnAgentInput,
	parseWebFetchInput,
	shortenPath,
} from "../../utils/tool-parsing";

function formatApprovalParams(
	toolName: string,
	rawInput: unknown,
): React.ReactNode {
	switch (toolName) {
		case "read_files": {
			const info = parseReadFilesInput(rawInput);
			if (!info?.files.length) break;
			return info.files.map((f, i) => {
				const range =
					f.startLine != null
						? ` lines ${f.startLine}-${f.endLine ?? "end"}`
						: "";
				return (
					<text key={f.path} fg="gray" selectable>
						{"  "}
						{shortenPath(f.path, 60)}
						{range && <span fg="gray">{range}</span>}
						{i < info.files.length - 1 ? "\n" : ""}
					</text>
				);
			});
		}
		case "run_commands": {
			const info = parseRunCommandsInput(rawInput);
			if (!info?.commands.length) break;
			return info.commands.map((cmd, i) => (
				<text key={`cmd-${i.toString()}`} fg="gray" selectable>
					{"  "}$ {cmd}
				</text>
			));
		}
		case "editor":
		case "edit":
		case "write": {
			const info = parseEditorInput(rawInput);
			if (!info) break;
			return (
				<text fg="gray" selectable>
					{"  "}
					{shortenPath(info.path, 60)}
				</text>
			);
		}
		case "apply_patch": {
			const patchInfo = parseApplyPatchInput(rawInput);
			if (!patchInfo?.files.length) break;
			return (
				<text fg="gray" selectable>
					{"  "}
					{patchInfo.files.map((f) => shortenPath(f, 60)).join(", ")}
				</text>
			);
		}
		case "search_codebase": {
			const info = parseSearchInput(rawInput);
			if (!info?.queries.length) break;
			return (
				<text fg="gray" selectable>
					{"  "}
					{info.queries.join(", ")}
				</text>
			);
		}
		case "fetch_web_content": {
			const info = parseWebFetchInput(rawInput);
			if (!info?.urls.length) break;
			return info.urls.map((url, i) => (
				<text key={`url-${i.toString()}`} fg="gray" selectable>
					{"  "}
					{url}
				</text>
			));
		}
		case "spawn_agent": {
			const info = parseSpawnAgentInput(rawInput);
			if (!info) break;
			const task =
				info.task.length > 80 ? `${info.task.slice(0, 80)}...` : info.task;
			return (
				<text fg="gray" selectable>
					{"  "}
					{task}
				</text>
			);
		}
		case "switch_to_act_mode":
			return (
				<text fg="gray" selectable>
					{"  "}Switch from plan mode to act mode
				</text>
			);
		case "ask_followup_question": {
			if (rawInput && typeof rawInput === "object" && "question" in rawInput) {
				const q = String((rawInput as { question: unknown }).question);
				const preview = q.length > 80 ? `${q.slice(0, 80)}...` : q;
				return (
					<text fg="gray" selectable>
						{"  "}
						{preview}
					</text>
				);
			}
			break;
		}
	}

	if (rawInput != null) {
		const json = JSON.stringify(rawInput, null, 2);
		const preview = json.length > 200 ? `${json.slice(0, 200)}...` : json;
		return (
			<text fg="gray" selectable>
				{"  "}
				{preview}
			</text>
		);
	}
	return null;
}

export function ToolApprovalContent(
	props: ChoiceContext<boolean> & { request: ToolApprovalRequest },
) {
	useDialogKeyboard((key) => {
		if (key.name === "y" || key.name === "return") {
			props.resolve(true);
		}
		if (key.name === "n" || key.name === "escape") {
			props.resolve(false);
		}
	}, props.dialogId);

	const params = formatApprovalParams(
		props.request.toolName,
		props.request.input,
	);

	return (
		<box flexDirection="column" paddingX={1}>
			<text fg="yellow">Approve tool call?</text>

			<text fg="cyan" marginTop={1}>
				<strong>{props.request.toolName}</strong>
			</text>

			{params && (
				<box flexDirection="column" marginTop={1}>
					{params}
				</box>
			)}

			<text marginTop={1}>
				<span fg={palette.success}>[y]</span> approve{"  "}
				<span fg="red">[n]</span> deny
			</text>
		</box>
	);
}
