import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getComponentCatalogue } from "@opentui/react";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";

const isolatedRoot = mkdtempSync(join(tmpdir(), "cline-tui-smoke-"));
process.env.CLINE_DIR = join(isolatedRoot, ".cline");
process.env.CLINE_DATA_DIR = join(isolatedRoot, "data");
process.env.CLINE_PROVIDER_SETTINGS_PATH = join(isolatedRoot, "providers.json");
process.env.CLINE_HUB_DISCOVERY_PATH = join(isolatedRoot, "hub-discovery.json");
process.env.CLINE_NO_AUTO_UPDATE = "1";
process.env.CLINE_TELEMETRY_DISABLED = "1";

try {
	// Match the CLI's lazy TUI loading and exercise actual loading components.
	const { LoadingDialogContent } = await import(
		"../src/tui/components/dialogs/loading-dialog"
	);
	const { ClineModelPicker } = await import(
		"../src/tui/components/model-selector/cline-model-picker"
	);
	const cases = [
		{
			name: "loading dialog",
			content: <LoadingDialogContent message="Loading provider..." />,
			message: "Loading provider...",
		},
		{
			name: "model picker",
			content: <ClineModelPicker entries={[]} selected={0} loading />,
			message: "Loading models...",
		},
	];
	for (const { name, content, message } of cases) {
		// Registration must work even if an import's side effects were omitted.
		delete getComponentCatalogue().spinner;
		const setup = await testRender(content, { width: 80, height: 5 });
		try {
			await act(async () => {
				await setup.renderOnce();
			});
			const frame = setup.captureCharFrame();
			assert.ok(frame.includes(message), `${name} failed to render:\n${frame}`);
			assert.match(
				frame,
				/[\u2800-\u28ff]/,
				`${name} did not paint its spinner`,
			);
		} finally {
			await act(async () => {
				setup.renderer.destroy();
			});
		}
		console.log(`  Passed: ${name} renders its loading spinner`);
	}
} finally {
	rmSync(isolatedRoot, { recursive: true, force: true });
}
