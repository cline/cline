"use client";

import {
	AgentComposer,
	AgentComposerBody,
	AgentConversationLayout,
	AgentPullRequestBar,
	type AgentPullRequestData,
	type AgentScreenshot,
} from "@cline/ui";
import { RotateCcw, ScanEye, X } from "lucide-react";
import { useEffect, useState } from "react";
import { AgentHeader } from "@/components/agent-header";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { WindowTitleBarContent } from "@/components/window-title-bar";
import type { ChatMessage, ChatSessionStatus } from "@/lib/chat-schema";
import { ChatMessages } from "../chat-messages";
import board from "./screenshots/01-board.webp";
import palette from "./screenshots/02-palette.webp";
import search from "./screenshots/03-search.webp";
import filtered from "./screenshots/04-filtered.webp";
import dark from "./screenshots/05-dark.webp";
import mobile from "./screenshots/06-mobile.webp";

/*
 * Scripted preview of computer use ("close the loop") in cloud sessions. The
 * sandbox cannot stream screenshots to clients yet, so this replays a canned
 * session through the real transcript components. The screenshots were
 * captured from a fixture app with Xvfb, xdotool, and ImageMagick.
 */

const SESSION_ID = "computer-use-demo";
const TITLE = "Add a ⌘K command palette with quick filters";
const PROMPT =
	"Add a ⌘K / Ctrl+K command palette to the Tidepool board with quick filters for overdue, assigned to me, and high priority cards. Build it, run it in the browser, and verify it works before opening a PR.";

const SCREENSHOTS: AgentScreenshot[] = [
	{
		id: "board",
		src: board.src,
		title: "Board loads with the new Ctrl K hint",
		action: "launch",
		detail: "localhost:5173",
		status: "passed",
	},
	{
		id: "palette",
		src: palette.src,
		title: "Ctrl+K opens the command palette",
		action: "key",
		detail: "Ctrl+K",
		status: "passed",
	},
	{
		id: "search",
		src: search.src,
		title: "Fuzzy search narrows to “Show overdue”",
		action: "type",
		detail: "over",
		pointer: { x: 0.5, y: 0.285 },
		status: "passed",
	},
	{
		id: "filtered",
		src: filtered.src,
		title: "Overdue filter applied: 4 cards and a removable chip",
		action: "click",
		detail: "Show overdue",
		status: "passed",
	},
	{
		id: "dark",
		src: dark.src,
		title: "Palette follows the dark theme",
		action: "key",
		detail: "Ctrl+Shift+L",
		status: "passed",
	},
	{
		id: "mobile",
		src: mobile.src,
		title: "Palette fits a 390px mobile viewport",
		action: "resize",
		detail: "390×844",
		status: "passed",
	},
];

const PULL_REQUEST: AgentPullRequestData = {
	repository: "acme/tidepool",
	branch: "cline/command-palette",
	pullRequest: {
		number: 128,
		title: "Add ⌘K command palette with quick filters",
		url: "https://github.com/acme/tidepool/pull/128",
		state: "OPEN",
		isDraft: false,
		mergeable: "MERGEABLE",
		mergeStateStatus: "CLEAN",
		additions: 312,
		deletions: 18,
		checks: [
			{ name: "test", state: "success" },
			{ name: "lint", state: "success" },
			{ name: "preview-deploy", state: "success" },
		],
	},
};

const FINAL_ANSWER = `Added a **command palette** to Tidepool and verified it end to end in the sandbox.

- \`Ctrl K\` / \`⌘K\` opens it from anywhere and \`Esc\` closes it
- Quick filters for **overdue**, **assigned to me**, and **high priority**, applied as a removable chip
- Fuzzy search with match highlighting, plus theme and clear-filter actions
- 5 new tests, 26 passing

I ran the app in the sandbox's browser and drove it with the keyboard and mouse across light, dark, and a 390px viewport. The PR is [#128](https://github.com/acme/tidepool/pull/128).`;

type Beat =
	| { wait: number; status: ChatSessionStatus; label?: string }
	| { wait: number; say: string; stream?: boolean }
	| {
			wait: number;
			tool: string;
			input: unknown;
			result: unknown;
			runMs: number;
	  };

const commandResult = (query: string, result: string) => [{ query, result }];
const screenshotResult = (data: string) => [
	{ type: "image", mediaType: "image/webp", data },
];

function buildBeats(images: string[]): Beat[] {
	const [boardImg, paletteImg, searchImg, filteredImg, darkImg, mobileImg] =
		images;
	return [
		{ wait: 400, status: "starting", label: "Provisioning cloud sandbox…" },
		{ wait: 1500, status: "starting", label: "Cloning acme/tidepool…" },
		{ wait: 1300, status: "running" },
		{
			wait: 900,
			say: "I'll look at how the board handles shortcuts and filtering, then build the palette on top of it.",
		},
		{
			wait: 500,
			tool: "read_files",
			input: {
				files: [
					"src/App.tsx",
					"src/board/Board.tsx",
					"src/hooks/useHotkeys.ts",
				],
			},
			result: "ok",
			runMs: 700,
		},
		{
			wait: 300,
			tool: "search_codebase",
			input: { queries: ["applyFilter"] },
			result: "src/board/filters.ts:12",
			runMs: 600,
		},
		{
			wait: 600,
			tool: "editor",
			input: {
				path: "src/components/CommandPalette.tsx",
				new_text: `export function CommandPalette() {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const { commands, run } = useBoardCommands();
	useHotkeys("mod+k", () => setOpen(true));
	useHotkeys("escape", () => setOpen(false), { enabled: open });
	const results = useMemo(() => fuzzyMatch(commands, query), [commands, query]);
	if (!open) return null;
	return (
		<Dialog label="Command palette" onClose={() => setOpen(false)}>
			<PaletteInput autoFocus value={query} onChange={setQuery} />
			<PaletteList results={results} onRun={(command) => { run(command); setOpen(false); }} />
		</Dialog>
	);
}`,
			},
			result: "Created src/components/CommandPalette.tsx",
			runMs: 900,
		},
		{
			wait: 400,
			tool: "editor",
			input: {
				path: "src/App.tsx",
				old_text: `<SearchButton />\n\t\t\t<Board />`,
				new_text: `<SearchButton shortcut={isMac ? "⌘K" : "Ctrl K"} />\n\t\t\t<Board />\n\t\t\t<CommandPalette />`,
			},
			result: "Edited src/App.tsx",
			runMs: 700,
		},
		{
			wait: 500,
			tool: "run_commands",
			input: { commands: ["bun test"] },
			result: commandResult(
				"bun test",
				"src/components/CommandPalette.test.tsx:\n✓ opens with mod+k and closes with escape\n✓ highlights fuzzy matches\n✓ running a filter applies the chip\n\n 26 pass\n 0 fail\nRan 26 tests across 7 files. [412.00ms]",
			),
			runMs: 1600,
		},
		{
			wait: 700,
			say: "Tests pass. Next I'll run the app in the sandbox's browser and check the palette the way a user would.",
		},
		{
			wait: 500,
			tool: "run_commands",
			input: {
				commands: [
					"bun run dev & Xvfb :99 -screen 0 1280x800x24 & DISPLAY=:99 google-chrome --app=http://localhost:5173 &",
				],
			},
			result: commandResult(
				"bun run dev",
				"VITE v6.3.5  ready in 312 ms\n➜  Local:   http://localhost:5173/\nChrome attached to display :99",
			),
			runMs: 1400,
		},
		{
			wait: 400,
			tool: "computer",
			input: { action: "screenshot" },
			result: screenshotResult(boardImg),
			runMs: 700,
		},
		{
			wait: 900,
			tool: "computer",
			input: { action: "key", text: "ctrl+k" },
			result: screenshotResult(paletteImg),
			runMs: 600,
		},
		{
			wait: 900,
			tool: "computer",
			input: { action: "type", text: "over" },
			result: screenshotResult(searchImg),
			runMs: 800,
		},
		{
			wait: 900,
			tool: "computer",
			input: { action: "left_click", coordinate: [640, 228] },
			result: screenshotResult(filteredImg),
			runMs: 600,
		},
		{
			wait: 900,
			tool: "computer",
			input: { action: "key", text: "ctrl+shift+l" },
			result: screenshotResult(darkImg),
			runMs: 600,
		},
		{
			wait: 900,
			tool: "run_commands",
			input: { commands: ["xdotool getactivewindow windowsize 390 844"] },
			result: commandResult("xdotool", ""),
			runMs: 500,
		},
		{
			wait: 300,
			tool: "computer",
			input: { action: "screenshot" },
			result: screenshotResult(mobileImg),
			runMs: 600,
		},
		{
			wait: 900,
			tool: "run_commands",
			input: {
				commands: [
					"git push -u origin cline/command-palette && gh pr create --fill",
				],
			},
			result: commandResult(
				"gh pr create",
				"https://github.com/acme/tidepool/pull/128",
			),
			runMs: 1300,
		},
		{ wait: 700, say: FINAL_ANSWER, stream: true },
		{ wait: 400, status: "completed" },
	];
}

async function toBase64(src: string): Promise<string> {
	const blob = await (await fetch(src)).blob();
	return await new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}

type DemoState = {
	messages: ChatMessage[];
	status: ChatSessionStatus;
	label?: string;
	streamingMessageId: string | null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function useDemoPlayback(run: number): DemoState {
	const [state, setState] = useState<DemoState>({
		messages: [],
		status: "starting",
		streamingMessageId: null,
	});
	useEffect(() => {
		void run;
		let cancelled = false;
		// Timestamps advance faster than playback so "Worked for…" reads like a real run.
		let clock = Date.now() - 4 * 60_000;
		const tick = (ms: number) => {
			clock += ms * 6;
			return clock;
		};
		const message = (
			id: string,
			role: ChatMessage["role"],
			content: string,
			meta?: ChatMessage["meta"],
		): ChatMessage => ({
			id,
			sessionId: SESSION_ID,
			role,
			content,
			createdAt: clock,
			meta,
		});
		const push = (next: ChatMessage) =>
			setState((current) => ({
				...current,
				messages: [...current.messages, next],
			}));
		const replace = (next: ChatMessage) =>
			setState((current) => ({
				...current,
				messages: current.messages.map((item) =>
					item.id === next.id ? next : item,
				),
			}));

		void (async () => {
			const images = await Promise.all(
				SCREENSHOTS.map((shot) => toBase64(shot.src)),
			);
			if (cancelled) return;
			setState({
				messages: [message("prompt", "user", PROMPT)],
				status: "starting",
				label: undefined,
				streamingMessageId: null,
			});
			let index = 0;
			for (const beat of buildBeats(images)) {
				await sleep(beat.wait);
				if (cancelled) return;
				tick(beat.wait);
				const id = `beat-${index++}`;
				if ("status" in beat) {
					setState((current) => ({
						...current,
						status: beat.status,
						label: beat.label,
					}));
				} else if ("say" in beat) {
					if (!beat.stream) {
						push(message(id, "assistant", beat.say));
						continue;
					}
					const words = beat.say.split(/(?<=\s)/);
					push(message(id, "assistant", ""));
					setState((current) => ({ ...current, streamingMessageId: id }));
					for (let count = 3; count < words.length + 3; count += 3) {
						await sleep(45);
						if (cancelled) return;
						replace(message(id, "assistant", words.slice(0, count).join("")));
					}
					setState((current) => ({ ...current, streamingMessageId: null }));
				} else {
					const meta = { toolName: beat.tool, toolCallId: id };
					push(
						message(
							id,
							"tool",
							JSON.stringify({
								toolName: beat.tool,
								input: beat.input,
								result: null,
							}),
							{
								...meta,
								hookEventName: "tool_call_start",
							},
						),
					);
					await sleep(beat.runMs);
					if (cancelled) return;
					tick(beat.runMs);
					replace(
						message(
							id,
							"tool",
							JSON.stringify({
								toolName: beat.tool,
								input: beat.input,
								result: beat.result,
							}),
							meta,
						),
					);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [run]);
	return state;
}

export function ComputerUseDemo({ onExit }: { onExit: () => void }) {
	const [run, setRun] = useState(0);
	const { messages, status, label, streamingMessageId } = useDemoPlayback(run);
	const completed = status === "completed";

	return (
		<div className="grid h-full min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
			<WindowTitleBarContent>
				<div className="cline-view-enter z-20 border-b border-border/70 bg-background/85 backdrop-blur-sm">
					<AgentHeader
						diff={completed ? { additions: 312, deletions: 18 } : undefined}
						onNewThread={onExit}
						status={status}
						title={TITLE}
					/>
				</div>
			</WindowTitleBarContent>
			<AgentConversationLayout
				body={
					<ChatMessages
						chatTransportState="connected"
						error={null}
						messages={messages}
						onAnswerAskQuestion={() => {}}
						onApproveToolApproval={() => {}}
						onRejectToolApproval={() => {}}
						pendingAskQuestions={[]}
						pendingToolApprovals={[]}
						sessionId={SESSION_ID}
						startingLabel={status === "starting" ? label : undefined}
						status={status}
						streamingMessageId={streamingMessageId}
						verification={
							completed
								? {
										screenshots: SCREENSHOTS,
										subtitle:
											"Chrome 1280×800 in the cloud sandbox · captured by the agent",
									}
								: undefined
						}
					/>
				}
				bodyClassName="cline-view-enter"
				composer={
					<AgentComposer>
						{completed ? (
							<AgentPullRequestBar
								data={PULL_REQUEST}
								onRefresh={() => {}}
								renderChecks={(trigger, content) => (
									<Popover>
										<PopoverTrigger asChild>{trigger}</PopoverTrigger>
										<PopoverContent align="end" className="w-72 p-0">
											{content}
										</PopoverContent>
									</Popover>
								)}
							/>
						) : null}
						<AgentComposerBody className="flex items-center gap-3">
							<ScanEye className="size-4 shrink-0 text-primary" />
							<p className="min-w-0 flex-1 text-sm text-muted-foreground">
								Scripted preview of computer use in cloud sessions. The agent
								builds, runs, and screenshots its own work.
							</p>
							<Button
								onClick={() => setRun((value) => value + 1)}
								size="sm"
								variant="outline"
							>
								<RotateCcw className="size-3.5" />
								Replay
							</Button>
							<Button onClick={onExit} size="sm" variant="ghost">
								<X className="size-3.5" />
								Exit
							</Button>
						</AgentComposerBody>
					</AgentComposer>
				}
				welcome={false}
			/>
		</div>
	);
}
