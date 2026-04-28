// @jsxImportSource @opentui/react
import type { ChoiceContext } from "@opentui-ui/dialog";
import { useDialogKeyboard } from "@opentui-ui/dialog/react";

type HelpRow =
	| { kind: "heading"; id: string; text: string }
	| { kind: "entry"; id: string; key: string; desc: string }
	| { kind: "spacer"; id: string };

const HELP_ROWS: HelpRow[] = [
	{ kind: "heading", id: "h-keys", text: "Keyboard Shortcuts" },
	{
		kind: "entry",
		id: "k-enter",
		key: "Enter",
		desc: "Submit prompt (or select autocomplete)",
	},
	{
		kind: "entry",
		id: "k-shift-enter",
		key: "Shift+Enter",
		desc: "Newline in input",
	},
	{
		kind: "entry",
		id: "k-tab",
		key: "Tab",
		desc: "Toggle Plan / Act mode",
	},
	{
		kind: "entry",
		id: "k-shift-tab",
		key: "Shift+Tab",
		desc: "Toggle auto-approve all",
	},
	{
		kind: "entry",
		id: "k-ctrl-c",
		key: "Ctrl+C",
		desc: "Abort running agent / Exit",
	},
	{
		kind: "entry",
		id: "k-ctrl-d",
		key: "Ctrl+D",
		desc: "Exit (when idle and input empty)",
	},
	{
		kind: "entry",
		id: "k-ctrl-l",
		key: "Ctrl+L",
		desc: "Clear conversation",
	},
	{
		kind: "entry",
		id: "k-ctrl-s",
		key: "Ctrl+S",
		desc: "Steer (send while agent is running)",
	},
	{
		kind: "entry",
		id: "k-escape",
		key: "Escape",
		desc: "Close menu / Abort / Exit",
	},
	{
		kind: "entry",
		id: "k-updown",
		key: "Up/Down",
		desc: "Navigate autocomplete or input history",
	},

	{ kind: "spacer", id: "s1" },
	{ kind: "heading", id: "h-slash", text: "Slash Commands" },
	{
		kind: "entry",
		id: "c-model",
		key: "/model",
		desc: "Switch model or provider",
	},
	{
		kind: "entry",
		id: "c-settings",
		key: "/settings",
		desc: "Open interactive config browser",
	},
	{
		kind: "entry",
		id: "c-mcp",
		key: "/mcp",
		desc: "Manage MCP servers",
	},
	{
		kind: "entry",
		id: "c-account",
		key: "/account",
		desc: "View Cline account and switch account",
	},
	{
		kind: "entry",
		id: "c-compact",
		key: "/compact",
		desc: "Compact context window",
	},
	{
		kind: "entry",
		id: "c-clear",
		key: "/clear",
		desc: "Start a new session",
	},
	{
		kind: "entry",
		id: "c-team",
		key: "/team",
		desc: "Start the task with agent team",
	},
	{
		kind: "entry",
		id: "c-history",
		key: "/history",
		desc: "View and resume past sessions",
	},
	{
		kind: "entry",
		id: "c-fork",
		key: "/fork",
		desc: "Fork current session into a new one",
	},
	{ kind: "entry", id: "c-quit", key: "/quit", desc: "Exit Cline" },
	{ kind: "entry", id: "c-help", key: "/help", desc: "Show this help" },

	{ kind: "spacer", id: "s2" },
	{ kind: "heading", id: "h-mentions", text: "Mentions" },
	{
		kind: "entry",
		id: "m-file",
		key: "@filename",
		desc: "Attach a workspace file to your prompt",
	},

	{ kind: "spacer", id: "s3" },
	{ kind: "heading", id: "h-modes", text: "Modes" },
	{
		kind: "entry",
		id: "mode-plan",
		key: "Plan",
		desc: "Agent explains what it would do without making changes",
	},
	{
		kind: "entry",
		id: "mode-act",
		key: "Act",
		desc: "Agent executes tools and makes changes (default)",
	},

	{ kind: "spacer", id: "s4" },
	{ kind: "heading", id: "h-approve", text: "Auto-Approve" },
	{
		kind: "entry",
		id: "approve-off",
		key: "Off",
		desc: "Safe tools auto-approved, others prompt for confirmation",
	},
	{
		kind: "entry",
		id: "approve-on",
		key: "On",
		desc: "All tool calls auto-approved without confirmation",
	},

	{ kind: "spacer", id: "s5" },
	{ kind: "heading", id: "h-wizards", text: "CLI Wizards" },
	{
		kind: "entry",
		id: "w-connect",
		key: "clite connect",
		desc: "Set up messaging platform integrations",
	},
	{
		kind: "entry",
		id: "w-schedule",
		key: "clite schedule",
		desc: "Create and manage scheduled cron tasks",
	},
	{
		kind: "entry",
		id: "w-mcp",
		key: "clite mcp",
		desc: "Add, remove, and manage MCP servers",
	},
];

const KEY_WIDTH = 16;

export function HelpDialogContent(
	props: ChoiceContext<void> & { showAccountCommand?: boolean },
) {
	const { dismiss, dialogId } = props;
	const showAccountCommand = props.showAccountCommand ?? true;

	useDialogKeyboard((key) => {
		if (
			key.name === "escape" ||
			key.name === "return" ||
			key.name === "enter" ||
			key.name === "q"
		) {
			dismiss();
		}
	}, dialogId);

	return (
		<box flexDirection="column" paddingX={1}>
			<scrollbox flexGrow={1}>
				<box flexDirection="column">
					{HELP_ROWS.filter(
						(row) => showAccountCommand || row.id !== "c-account",
					).map((row) => {
						if (row.kind === "spacer") {
							return <text key={row.id}> </text>;
						}
						if (row.kind === "heading") {
							return (
								<text key={row.id} fg="white">
									{row.text}
								</text>
							);
						}
						return (
							<box key={row.id} flexDirection="row" paddingX={1}>
								<text fg="cyan" width={KEY_WIDTH} flexShrink={0}>
									{row.key}
								</text>
								<text fg="gray">{row.desc}</text>
							</box>
						);
					})}
				</box>
			</scrollbox>

			<text fg="gray" marginTop={1}>
				<em>Esc/Enter to close</em>
			</text>
		</box>
	);
}
