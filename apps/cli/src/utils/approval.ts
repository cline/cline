import { createInterface } from "node:readline";
import type { ToolApprovalRequest, ToolApprovalResult } from "@cline/shared";
import { truncate } from "./helpers";
import { c, getActiveCliSession, write } from "./output";

const SHOW_TERMINAL_CURSOR = "\x1b[?25h";

// =============================================================================
// Desktop tool approval
// =============================================================================

let cachedDesktopApprovalRequester:
	| Promise<
			(
				request: ToolApprovalRequest,
				options?: {
					approvalDir?: string;
					sessionId?: string;
				},
			) => Promise<ToolApprovalResult>
	  >
	| undefined;

async function requestDesktopToolApprovalFromCore(
	request: ToolApprovalRequest,
): Promise<ToolApprovalResult> {
	if (!cachedDesktopApprovalRequester) {
		cachedDesktopApprovalRequester = import("@cline/core")
			.then((module) => {
				const fn = (
					module as {
						requestDesktopToolApproval?: (
							request: ToolApprovalRequest,
							options?: {
								approvalDir?: string;
								sessionId?: string;
							},
						) => Promise<ToolApprovalResult>;
					}
				).requestDesktopToolApproval;
				if (typeof fn !== "function") {
					throw new Error(
						"Installed @cline/core does not expose requestDesktopToolApproval",
					);
				}
				return fn;
			})
			.catch(() => {
				return async () => ({
					approved: false,
					reason: "Desktop tool approval IPC is not available",
				});
			});
	}
	const requester = await cachedDesktopApprovalRequester;
	const sessionId = getActiveCliSession()?.manifest.session_id;
	const approvalDir = process.env.CLINE_TOOL_APPROVAL_DIR?.trim();
	return requester(request, { approvalDir, sessionId });
}

// =============================================================================
// Terminal tool approval
// =============================================================================

async function requestTerminalToolApproval(
	request: ToolApprovalRequest,
): Promise<ToolApprovalResult> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		return {
			approved: false,
			reason: `Tool "${request.toolName}" requires approval in a TTY session`,
		};
	}
	const preview = truncate(JSON.stringify(request.input), 160);
	const answer = await new Promise<string>((resolve) => {
		const rl = createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		rl.question(
			`\n${c.yellow}Approve ${c.green}"${request.toolName}" ${c.dim}${preview} ${c.reset}[y/N] `,
			(value) => {
				rl.close();
				resolve(value);
			},
		);
	});
	const normalized = answer.trim().toLowerCase();
	if (normalized === "y" || normalized === "yes") {
		return { approved: true };
	}
	return {
		approved: false,
		reason: `Tool "${request.toolName}" was denied by user`,
	};
}

// =============================================================================
// Unified approval entry point
// =============================================================================

export async function requestToolApproval(
	request: ToolApprovalRequest,
): Promise<ToolApprovalResult> {
	const mode = process.env.CLINE_TOOL_APPROVAL_MODE?.trim().toLowerCase();
	if (mode === "desktop") {
		return requestDesktopToolApprovalFromCore(request);
	}
	return requestTerminalToolApproval(request);
}

// =============================================================================
// Interactive question
// =============================================================================

export async function askQuestionInTerminal(
	question: string,
	options: string[],
): Promise<string> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		return options[0] ?? "";
	}

	return new Promise<string>((resolve) => {
		const rl = createInterface({
			input: process.stdin,
			output: process.stdout,
		});

		write(`\n${c.dim}[follow-up]${c.reset} ${question}\n`);
		for (const [index, option] of options.entries()) {
			write(`${c.dim}  ${index + 1}.${c.reset} ${option}\n`);
		}
		// Terminal renderers can hide the cursor; restore it so readline shows a
		// normal blinking insertion point for the follow-up.
		write(SHOW_TERMINAL_CURSOR);
		write(
			`${c.dim}Choose 1-${options.length} or type a custom answer:${c.reset}\n${c.green}>${c.reset} `,
		);

		rl.question("", (value) => {
			rl.close();
			const trimmed = value.trim();
			const numeric = Number.parseInt(trimmed, 10);
			if (
				Number.isInteger(numeric) &&
				numeric >= 1 &&
				numeric <= options.length
			) {
				resolve(options[numeric - 1] ?? "");
				return;
			}
			if (trimmed.length > 0) {
				resolve(trimmed);
				return;
			}
			resolve(options[0] ?? "");
		});
	});
}

export async function submitAndExitInTerminal(
	summary: string,
	verified: boolean,
): Promise<string> {
	const status = verified ? "verified" : "unverified";
	return `Submission recorded (${status}): ${summary}`;
}
