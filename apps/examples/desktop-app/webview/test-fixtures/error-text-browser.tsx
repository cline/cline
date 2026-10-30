import { createRoot } from "react-dom/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LocalRuntimeSetup } from "@/components/views/settings/local-runtime-setup";
import type { LocalModelsStatus } from "@/lib/local-models";

const status: LocalModelsStatus = {
	runtime: "ollama",
	baseUrl: "http://localhost:11434",
	reachable: false,
	install: { installed: true, localServer: true },
	hardware: {
		platform: "darwin",
		arch: "arm64",
		cpuModel: "Test CPU",
		cpuCores: 8,
		totalMemoryGb: 16,
		unifiedMemory: true,
		gpus: [],
	},
	runtimes: {
		ollama: { installed: true, reachable: false },
		lmstudio: { installed: false, reachable: false },
	},
	installed: [],
	running: [],
	activePulls: [],
};

const root = document.getElementById("root");
if (!root) throw new Error("Missing error-text fixture root");

createRoot(root).render(
	<main className="min-h-screen space-y-6 bg-background p-8 text-foreground">
		<div id="runtime-fixture">
			<LocalRuntimeSetup
				onRefresh={() => {}}
				onStart={async () => {
					throw new Error("Ollama could not be started. Try again.");
				}}
				refreshing={false}
				runtime="ollama"
				status={status}
			/>
		</div>
		<Alert id="error-alert" variant="destructive">
			<AlertTitle>Unable to save settings</AlertTitle>
			<AlertDescription>
				Check the configuration and try again.
			</AlertDescription>
		</Alert>
		<Alert
			className="bg-destructive/10"
			id="tinted-error"
			variant="destructive"
		>
			<AlertDescription>
				The connection could not be established.
			</AlertDescription>
		</Alert>
		<Button id="destructive-action" variant="destructive">
			Delete configuration
		</Button>
	</main>,
);
