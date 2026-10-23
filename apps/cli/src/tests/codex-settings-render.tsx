// Run separately with Bun: bun src/tests/codex-settings-render.tsx
// Real source + native OpenTUI renderer + dialog keyboard routing; no CLI/hub/auth.
import assert from "node:assert/strict";
import { testRender } from "@opentui/react/test-utils";
import {
	type DialogActions,
	DialogProvider,
	useDialog,
} from "@opentui-ui/dialog/react";
import { act } from "react";
import {
	type CodexSettings,
	CodexSettingsContent,
	codexCurrentThinking,
	FAST_WARNING,
} from "../tui/components/model-selector/codex-settings";
import type { ModelOption } from "../tui/components/model-selector/model-selector";
import { TerminalColorsContext } from "../tui/hooks/use-theme";

const model: ModelOption = {
	key: "gpt-6-astra",
	name: "GPT-6 Astra",
	supportsReasoning: true,
	reasoningOptions: [
		{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] },
	],
};
let cases = 0;
for (const theme of ["dark", "light"] as const) {
	let dialog!: DialogActions;
	function Harness() {
		dialog = useDialog();
		return <text>Settings test host</text>;
	}
	const ui = await testRender(
		<TerminalColorsContext.Provider
			value={
				theme === "dark"
					? { background: "#101010", foreground: "#eeeeee" }
					: { background: "#ffffff", foreground: "#111111" }
			}
		>
			<DialogProvider>
				<Harness />
			</DialogProvider>
		</TerminalColorsContext.Provider>,
		{ width: 120, height: 40 },
	);
	const frame = async () => {
		await act(async () => {
			await ui.renderOnce();
		});
		return ui.captureCharFrame().replace(/\s+/g, " ").trim();
	};
	const press = async (key: string) => {
		await act(async () => {
			ui.mockInput.pressKey(key);
			// A bare ESC waits for the terminal parser's sequence-disambiguation timeout.
			if (key === "ESCAPE") await Bun.sleep(100);
		});
		return frame();
	};
	try {
		// Resize the same renderer in both directions, rather than fresh mounts only.
		for (const width of [120, 100, 80, 60, 80, 100, 120]) {
			await act(async () => {
				ui.resize(width, 40);
			});
			for (const state of [
				"off",
				"enabled",
				"unsupported",
				"missing",
			] as const) {
				const current: CodexSettings = {
					thinking:
						state === "off"
							? codexCurrentThinking({
									thinking: false,
									reasoningEffort: "high",
								})
							: state === "unsupported"
								? "minimal"
								: "high",
					fast: false,
				};
				let result: CodexSettings | undefined;
				let settled = false;
				const open = async () => {
					settled = false;
					await act(async () => {
						void dialog
							.choice<CodexSettings>({
								content: (ctx) => (
									<CodexSettingsContent
										{...ctx}
										modelName={model.name}
										model={state === "missing" ? undefined : model}
										current={current}
									/>
								),
							})
							.then((value) => {
								result = value;
								settled = true;
							});
					});
					return frame();
				};
				const thinkingLabel =
					current.thinking === "none" ? "Off" : current.thinking;
				let screen = await open();
				assert.ok(screen.includes(`Thinking: ${thinkingLabel}`), screen);
				assert.ok(screen.includes("Fast: Off"), screen);
				assert.ok(screen.includes(FAST_WARNING), screen);
				assert.ok(screen.includes("Esc cancel"), screen);
				if (state === "missing")
					assert.ok(screen.includes("effort options unavailable"), screen);
				if (state === "unsupported" || state === "off")
					assert.ok(screen.includes("not supported by selected model"), screen);
				await press("ARROW_DOWN");
				screen = await press("RETURN");
				assert.ok(screen.includes("❯ Fast: On (priority requested)"), screen);
				assert.ok(screen.includes(`Thinking: ${thinkingLabel}`), screen);
				assert.equal(settled, false);
				screen = await press("ARROW_LEFT");
				assert.ok(screen.includes("❯ Fast: Off"), screen);
				assert.ok(screen.includes(`Thinking: ${thinkingLabel}`), screen);
				await press("ARROW_RIGHT");
				await press("ARROW_UP");
				screen = await press("ARROW_RIGHT");
				const changed =
					state === "missing" ? "high" : state === "enabled" ? "xhigh" : "low";
				assert.ok(screen.includes(`❯ Thinking: ${changed}`), screen);
				assert.ok(screen.includes("Fast: On (priority requested)"), screen);
				await press("TAB");
				screen = await press("TAB");
				assert.ok(screen.includes("❯ Apply settings"), screen);
				if (width === 60 && state === "off") {
					console.log(`READBACK ${theme} ${width}: ${screen}`);
				}
				screen = await press("RETURN");
				assert.equal(settled, true);
				assert.deepEqual(result, { thinking: changed, fast: true });
				assert.ok(!screen.includes("Settings for"), screen);
				await open();
				await press("ARROW_DOWN");
				await press("RETURN");
				screen = await press("ESCAPE");
				assert.equal(settled, true);
				assert.equal(result, undefined);
				assert.equal(current.fast, false);
				assert.ok(!screen.includes("Settings for"), screen);
				cases++;
			}
			console.log(
				`PASS ${theme} ${width} columns: four states, keyboard independence, Apply and Escape readback`,
			);
		}
	} finally {
		await act(async () => {
			ui.renderer.destroy();
		});
	}
}
console.log(
	`PASS ${cases} real-source render scenarios (4 widths, 2 themes, 4 states, bidirectional resize)`,
);
