/**
 * DEV-ONLY gallery for the chat activity folding (see chat-view/utils/activityFolding.ts).
 *
 * It renders the real chat components against synthetic messages, so the fold behaviour can be
 * reviewed (and screenshotted) without an extension host or provider credentials:
 *
 *   cd apps/vscode/webview-ui && bunx vite        → http://127.0.0.1:25463/gallery.html
 *
 * Not part of the extension bundle (only reachable through gallery.html).
 */
import type { ClineMessage, TurnPhase } from "@shared/ExtensionMessage"
import type React from "react"
import { createRoot } from "react-dom/client"
import "../index.css"
import "../main.css"
import { createMessageRenderer } from "../components/chat/chat-view/components/messages/MessageRenderer"
import { getActivityGroupKey, groupAgentActivities, isActivityGroup } from "../components/chat/chat-view/utils/activityFolding"
import { ExtensionStateContext } from "../context/ExtensionStateContext"

const T0 = 1_730_000_000_000

const say = (ts: number, kind: ClineMessage["say"], text: string, partial = false): ClineMessage => ({
	ts,
	type: "say",
	say: kind,
	text,
	...(partial ? { partial: true } : {}),
})

const toolSay = (ts: number, tool: Record<string, unknown>): ClineMessage => say(ts, "tool", JSON.stringify(tool))

const DIFF = `------- SEARCH
# Anlaufstrom: mehrere Platten gleichzeitig anlaufen zu lassen haengt schon
- mal die 12-V-Schiene. Zwischen den Starts kurz warten.
if [ "$SMODE" != abort ] && [ "$STAGGER" -gt 0 ]; then sleep "$STAGGER"; fi
-
=======
# Anlaufstrom: mehrere Platten gleichzeitig anlaufen zu lassen haengt schon
# mal die 12-V-Schiene. Zwischen den Starts kurz warten, nach dem letzten nicht.
if [ "$SMODE" != abort ] && [ "$STAGGER" -gt 0 ] && [ $((i + 1)) -lt "$LAST" ]; then
  sleep "$STAGGER"
fi
+++++++ REPLACE
`

const COMMAND_OUTPUT = `cd /home/userb/operations/testing/hardware/sata && bash -n 01-selftest-start.sh && scp -q 01-selftest-start.sh XXX:hw-sata/
Output:
6gb   sdd   TOSHIBA MG08ACA16TE   XXXXXXHNFVGG   306   24h07m laufend   /mnt/toshiba-MG08ACA16TE-Backup-15T
20tb  sde   ST4000NM000A-2CV104   XXXX0HVP       3011  8h14m laufend    /mnt/st4000DM
4tb   sdf   ST4000DM000-1FR168    XX99           112   2h01m laufend    /mnt/st4000dm-1fr`

/** One agent turn: thinking, a file edit, a command, reads/searches and a final answer. */
export const turnMessages = (offset = 0, lastPartial = false): ClineMessage[] => [
	say(T0 + offset, "task", "Führe den SATA-Selbsttest auf allen Platten aus und korrigiere die Staffelung im Startskript."),
	say(
		T0 + offset + 1_000,
		"reasoning",
		"Ich schaue mir zuerst das Startskript an, prüfe die Syntax und starte dann den Selbsttest auf allen drei Platten.",
	),
	toolSay(T0 + offset + 2_000, {
		tool: "editedExistingFile",
		path: "testing/hardware/sata/01-selftest-start.sh",
		diff: DIFF,
		operationIsLocatedInWorkspace: true,
	}),
	say(T0 + offset + 3_000, "reasoning", "Syntax ok. Jetzt der eigentliche Lauf, danach hole ich das Log ab."),
	say(T0 + offset + 4_000, "command", COMMAND_OUTPUT, lastPartial),
	toolSay(T0 + offset + 5_000, {
		tool: "readFile",
		path: "testing/hardware/sata/03-selftest-log.sh",
		content: '#!/usr/bin/env bash\nset -euo pipefail\nsudo smartctl -l selftest "$DEV" | tail -n 20\n',
		readLineStart: 1,
		readLineEnd: 24,
	}),
	toolSay(T0 + offset + 5_500, {
		tool: "searchFiles",
		path: "testing/hardware/sata",
		regex: "selftest|STAGGER",
		filePattern: "*.sh",
		content: "Found 4 results:\n01-selftest-start.sh:12\n02-selftest-wait.sh:8\n03-selftest-log.sh:3\nlib.sh:21",
	}),
	say(
		T0 + offset + 6_000,
		"text",
		"Der Selbsttest läuft auf allen drei Platten. Die Staffelung wird jetzt nach der letzten Platte nicht mehr ausgeführt.",
	),
]

/** Two turns with a follow-up prompt in between — closer to a real session. */
export const conversation = (lastPartial = false): ClineMessage[] => [
	...turnMessages(0),
	say(T0 + 50_000, "user_feedback", "Danke. Bitte prüfe auch das Log der 20 TB-Platte."),
	...turnMessages(100_000),
	say(T0 + 150_000, "user_feedback", "Und am Ende eine kurze Zusammenfassung im Skript-Kommentar."),
	...turnMessages(200_000, lastPartial),
]

const mockExtensionState = {
	mode: "act",
	clineMessages: [],
	mcpServers: {},
	backgroundEditEnabled: true,
	vscodeTerminalExecutionMode: "backgroundExec",
	showFeatureTips: false,
	enableCheckpointsSetting: false,
	currentCloudTask: undefined,
	workspaceRoots: ["/home/userb/operations"],
	primaryWorkspaceRootPath: "/home/userb/operations",
	cwdOnTaskInitialization: "/home/userb/operations",
	rateLimitSeconds: 0,
	strictPlanModeEnabled: false,
	yoloModeToggled: false,
	enableNativeToolCall: false,
	dictationEnabled: false,
	showSelfHostingLinks: false,
	navigateToSettings: () => {},
	navigateToChat: () => {},
	apiConfiguration: {},
}

interface SceneProps {
	title: string
	hint: string
	messages: ClineMessage[]
	turnPhase?: TurnPhase
	expandedRows?: Record<number, boolean>
	folding?: boolean
	height?: number
}

const Scene: React.FC<SceneProps> = ({ title, hint, messages, turnPhase, expandedRows = {}, folding = true, height = 560 }) => {
	const grouped = groupAgentActivities(messages, { enabled: folding })
	const itemContent = createMessageRenderer(
		grouped,
		messages,
		expandedRows,
		() => {},
		() => {},
		() => {},
		() => {},
		"",
		{} as never,
		false,
	)

	return (
		<div className="scene" data-scene={title}>
			<h2>{title}</h2>
			<p>{hint}</p>
			<div className="sidebar" style={{ height }}>
				<ExtensionStateContext.Provider
					value={
						{
							...mockExtensionState,
							clineMessages: messages,
							turnState: turnPhase ? { phase: turnPhase, seq: 1 } : undefined,
						} as never
					}>
					<div className="chat-scroll scrollable chat-scrollbar">
						{grouped.map((item, index) => (
							<div key={index}>{itemContent(index, item)}</div>
						))}
					</div>
				</ExtensionStateContext.Provider>
			</div>
		</div>
	)
}

const firstFold = groupAgentActivities(conversation()).find(isActivityGroup) as ClineMessage[]

const Gallery = () => (
	<div>
		<div className="scene-row">
			<Scene
				folding={false}
				hint="Der Stand vor dem Folding: Thinking, Diff, Kommando-Ausgabe und Datei-Lesungen füllen das Fenster."
				messages={conversation()}
				title="1 · Vorher: jede Aktion ein Block"
				turnPhase="idle"
			/>
			<Scene
				hint="Abgeschlossene Aktionen klappen zu einer Summary-Zeile pro Block zusammen; Prompt und Antwort bleiben lesbar."
				messages={conversation()}
				title="2 · Nachher: gefaltet"
				turnPhase="idle"
			/>
		</div>
		<div className="scene-row">
			<Scene
				expandedRows={{ [getActivityGroupKey(firstFold)]: true }}
				hint="Ein Klick auf die Zeile zeigt alle ausgeführten Aktionen inklusive Diff, Kommando und Output."
				messages={conversation()}
				title="3 · Fold geöffnet"
				turnPhase="idle"
			/>
			<Scene
				hint="Solange etwas läuft (Spinner), bleibt der aktuelle Block offen — erst danach faltet er sich."
				messages={conversation(true)}
				title="4 · Während die Agentin arbeitet"
				turnPhase="streaming"
			/>
		</div>
		<div className="scene-row">
			<Scene
				height={300}
				hint="Der Chat hat jetzt einen dauerhaft sichtbaren Scrollbalken in den VS-Code-Farben, um zwischen Prompts und Antworten zu springen."
				messages={conversation()}
				title="5 · Scrollbalken im Chat-Fenster"
				turnPhase="idle"
			/>
		</div>
	</div>
)

createRoot(document.getElementById("root")!).render(<Gallery />)
