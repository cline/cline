import type { ClineMessage } from "@shared/ExtensionMessage"
import { RotateCcwIcon, ScanEyeIcon, XIcon } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { ExtensionStateContext, useExtensionState } from "@/context/ExtensionStateContext"
import board from "./screenshots/01-board.webp?inline"
import palette from "./screenshots/02-palette.webp?inline"
import search from "./screenshots/03-search.webp?inline"
import filtered from "./screenshots/04-filtered.webp?inline"
import dark from "./screenshots/05-dark.webp?inline"
import mobile from "./screenshots/06-mobile.webp?inline"

/*
 * Dev-only scripted preview of computer use ("close the loop") in cloud tasks,
 * started by the `cline.dev.playComputerUseDemo` command. Sandboxes cannot send
 * screenshots to clients yet, so this replays a canned task through the real
 * ChatView. The screenshots were captured from a fixture app with Xvfb, xdotool,
 * and ImageMagick, and are inlined because the webview CSP blocks fetch().
 */

const PROMPT =
	"Add a ⌘K / Ctrl+K command palette to the Tidepool board with quick filters for overdue, assigned to me, and high priority cards. Build it, run it in the browser, and verify it works before opening a PR."

const SHOTS = [
	{ src: board, name: "Board loads with the new Ctrl K hint" },
	{ src: palette, name: "Ctrl+K opens the command palette" },
	{ src: search, name: "Fuzzy search narrows to “Show overdue”" },
	{ src: filtered, name: "Overdue filter applied: 4 cards and a removable chip" },
	{ src: dark, name: "Palette follows the dark theme" },
	{ src: mobile, name: "Palette fits a 390px mobile viewport" },
]

const COMPLETION = `Added a **command palette** to Tidepool and verified it in the sandbox's browser.

- \`Ctrl K\` / \`⌘K\` opens it and \`Esc\` closes it
- Quick filters for **overdue**, **assigned to me**, and **high priority**, applied as a removable chip
- 5 new tests, 26 passing

I drove the app with the keyboard and mouse across light, dark, and a 390px viewport. Screenshots below; the PR is [#128](https://github.com/acme/tidepool/pull/128).`

type Beat = { wait: number; message: Omit<ClineMessage, "ts" | "type">; stream?: boolean; status?: "running" | "completed" }

const say = (wait: number, sayType: ClineMessage["say"], text: string, extra: Partial<ClineMessage> = {}): Beat => ({
	wait,
	message: { say: sayType, text, ...extra },
})
const tool = (wait: number, payload: Record<string, unknown>) => say(wait, "tool", JSON.stringify(payload))
const apiRequest = (wait: number, cost: number) =>
	say(wait, "api_req_started", JSON.stringify({ request: "", tokensIn: 18_200, tokensOut: 1_450, cost }))
const command = (wait: number, text: string, output: string): Beat[] => [
	say(wait, "command", text, { commandCompleted: true }),
	say(250, "command_output", output),
]
const capture = (wait: number, input: string, file: string) =>
	command(wait, `${input} && import -window root shots/${file}`, `saved shots/${file}`)

function buildBeats(media: NonNullable<ClineMessage["media"]>): Beat[] {
	return [
		apiRequest(1200, 0.012),
		say(900, "text", "I'll look at how the board handles shortcuts and filtering, then build the palette on top of it."),
		tool(600, { tool: "readFile", path: "src/App.tsx", content: "/workspace/src/App.tsx" }),
		tool(300, { tool: "readFile", path: "src/board/Board.tsx", content: "/workspace/src/board/Board.tsx" }),
		tool(300, { tool: "searchFiles", path: "src", regex: "applyFilter", content: "src/board/filters.ts:12" }),
		tool(800, {
			tool: "newFileCreated",
			path: "src/components/CommandPalette.tsx",
			content: `export function CommandPalette() {
	const [open, setOpen] = useState(false)
	const [query, setQuery] = useState("")
	const { commands, run } = useBoardCommands()
	useHotkeys("mod+k", () => setOpen(true))
	const results = useMemo(() => fuzzyMatch(commands, query), [commands, query])
	if (!open) return null
	return (
		<Dialog label="Command palette" onClose={() => setOpen(false)}>
			<PaletteInput autoFocus value={query} onChange={setQuery} />
			<PaletteList results={results} onRun={run} />
		</Dialog>
	)
}`,
		}),
		...command(
			900,
			"bun test",
			"src/components/CommandPalette.test.tsx:\n✓ opens with mod+k and closes with escape\n✓ running a filter applies the chip\n\n 26 pass\n 0 fail",
		),
		apiRequest(800, 0.018),
		say(700, "text", "Tests pass. Now I'll run the app in the sandbox's browser and check it the way a user would."),
		...command(
			700,
			"bun run dev & DISPLAY=:99 google-chrome --app=http://localhost:5173 &",
			"VITE v6.3.5  ready in 312 ms\n➜  Local:   http://localhost:5173/",
		),
		...capture(900, "xdotool search --sync --class chrome windowactivate", "01-board.png"),
		...capture(900, "xdotool key ctrl+k", "02-palette.png"),
		...capture(900, "xdotool type over && xdotool mousemove 640 228", "03-search.png"),
		...capture(900, "xdotool click 1", "04-filtered.png"),
		...capture(900, "xdotool key ctrl+shift+l", "05-dark.png"),
		...capture(900, "xdotool getactivewindow windowsize 390 844", "06-mobile.png"),
		...SHOTS.map((_, index) =>
			tool(index === 0 ? 700 : 150, {
				tool: "readFile",
				path: `shots/0${index + 1}.png`,
				content: `/workspace/shots/0${index + 1}.png`,
			}),
		),
		...command(
			800,
			"git push -u origin cline/command-palette && gh pr create --fill",
			"https://github.com/acme/tidepool/pull/128",
		),
		{ ...say(900, "completion_result", COMPLETION, { media }), stream: true, status: "completed" },
	]
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function useDemoPlayback(run: number) {
	const [messages, setMessages] = useState<ClineMessage[]>([])
	const [completed, setCompleted] = useState(false)
	useEffect(() => {
		if (!run) return
		let cancelled = false
		let ts = Date.now() - 4 * 60_000
		const push = (message: Omit<ClineMessage, "ts" | "type">, partial = false) => {
			ts += 7_000
			const next = { ...message, ts, type: "say", partial } as ClineMessage
			setMessages((current) => [...current, next])
			return next.ts
		}
		void (async () => {
			const media = SHOTS.map((shot, index) => ({
				id: `computer-use-demo-${index}`,
				modality: "image" as const,
				mediaType: "image/webp",
				name: shot.name,
				source: { type: "base64" as const, data: shot.src.split(",")[1] ?? "" },
			}))
			setCompleted(false)
			setMessages([])
			push({ say: "task", text: PROMPT })
			for (const beat of buildBeats(media)) {
				await sleep(beat.wait)
				if (cancelled) return
				if (!beat.stream) {
					push(beat.message)
					continue
				}
				const text = beat.message.text ?? ""
				const words = text.split(/(?<=\s)/)
				const id = push({ ...beat.message, text: "", media: undefined }, true)
				for (let count = 3; count < words.length + 3; count += 3) {
					await sleep(45)
					if (cancelled) return
					const partial = count < words.length
					setMessages((current) =>
						current.map((message) =>
							message.ts === id
								? {
										...message,
										text: words.slice(0, count).join(""),
										partial,
										media: partial ? undefined : beat.message.media,
									}
								: message,
						),
					)
				}
				if (beat.status === "completed") setCompleted(true)
			}
		})()
		return () => {
			cancelled = true
		}
	}, [run])
	return { messages, completed }
}

export function ComputerUseDemo({ children }: { children: ReactNode }) {
	const state = useExtensionState()
	const [run, setRun] = useState(0)
	const [active, setActive] = useState(false)
	const { messages, completed } = useDemoPlayback(run)

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			if (event.data?.type === "computer_use_demo") {
				setActive(true)
				setRun((value) => value + 1)
			}
		}
		window.addEventListener("message", onMessage)
		return () => window.removeEventListener("message", onMessage)
	}, [])

	const playing = active && messages.length > 0

	return (
		<ExtensionStateContext.Provider
			value={
				playing
					? {
							...state,
							clineMessages: messages,
							queuedPrompts: [],
							currentCloudTask: {
								sessionId: "computer-use-demo",
								repoUrl: "https://github.com/acme/tidepool",
								branch: "main",
								status: completed ? "completed" : "running",
							},
							turnState: { phase: completed ? "completed" : "streaming", seq: Number.MAX_SAFE_INTEGER },
						}
					: state
			}>
			{playing && (
				<div className="flex items-center gap-2 border-b border-editor-group-border px-3 py-1.5 text-xs text-description">
					<ScanEyeIcon className="size-3.5 shrink-0 text-link" />
					<span className="min-w-0 flex-1 truncate">Scripted preview of computer use in cloud tasks</span>
					<button
						className="flex items-center gap-1 rounded-xs px-1.5 py-0.5 hover:bg-toolbar-hover"
						onClick={() => setRun((value) => value + 1)}
						type="button">
						<RotateCcwIcon className="size-3" />
						Replay
					</button>
					<button
						aria-label="Exit demo"
						className="flex items-center rounded-xs p-0.5 hover:bg-toolbar-hover"
						onClick={() => setActive(false)}
						type="button">
						<XIcon className="size-3.5" />
					</button>
				</div>
			)}
			{children}
		</ExtensionStateContext.Provider>
	)
}
