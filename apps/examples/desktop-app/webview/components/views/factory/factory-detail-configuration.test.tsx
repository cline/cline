// @vitest-environment jsdom
import { type FactoryTaskConfig, factoryTaskConfigSchema } from "@cline/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	FactoryDetailConfiguration,
	FactoryVerificationSetup,
} from "./factory-detail-configuration";

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: vi.fn(async () => ({})) },
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

const render = (config: FactoryTaskConfig) =>
	act(async () =>
		root.render(
			<FactoryDetailConfiguration
				config={config}
				disabled={false}
				setConfig={vi.fn()}
				perform={vi.fn()}
			/>,
		),
	);

describe("Factory configuration before approval", () => {
	it("shows the verifier app commands beside the checks", async () => {
		await render(
			factoryTaskConfigSchema.parse({
				checks: [{ name: "API", command: "node check.mjs", kind: "api" }],
				agents: {
					verifier: {
						environment: {
							setup: "bun install",
							start: "bun run dev --port $FACTORY_APP_PORT",
							cleanup: "docker compose down",
						},
					},
				},
			}),
		);
		const section = container.querySelector(
			'[aria-label="Verifier app environment"]',
		);
		expect(section?.textContent).toContain("Setupbun install");
		expect(section?.textContent).toContain(
			"Startbun run dev --port $FACTORY_APP_PORT",
		);
		expect(section?.textContent).toContain("Cleanupdocker compose down");
		expect(section?.textContent).not.toContain("Healthcheck");
		// It follows the checks so both are reviewed together.
		const checks = Array.from(container.querySelectorAll("h3")).find(
			(heading) => heading.textContent === "Required checks and evidence",
		);
		if (!checks || !section) throw new Error("Missing configuration sections");
		expect(
			checks.compareDocumentPosition(section) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	it("shows nothing without an environment", async () => {
		await render(factoryTaskConfigSchema.parse({ agents: { verifier: {} } }));
		expect(
			container.querySelector('[aria-label="Verifier app environment"]'),
		).toBeNull();
	});
});

describe("Factory configuration on hands-off cards", () => {
	it("is a read-only summary without the plan's criteria or an edit button", async () => {
		const config = factoryTaskConfigSchema.parse({
			autonomy: "hands_off",
			publishPullRequest: true,
			checks: [{ name: "API", command: "node check.mjs", kind: "api" }],
			acceptanceCriteria: [
				{ id: "c1", text: "Search finds titles", check: "API" },
			],
			workflow: { name: "Careful", revision: "a".repeat(64) },
		});
		const summary = (checksShownElsewhere: boolean) =>
			root.render(
				<FactoryDetailConfiguration
					config={config}
					disabled={false}
					setConfig={vi.fn()}
					perform={vi.fn()}
					readOnly
					checksShownElsewhere={checksShownElsewhere}
				/>,
			);
		await act(async () => summary(false));
		expect(container.textContent).toContain(
			"Workflow “Careful” · Publishes a draft PR · Keeps it green",
		);
		expect(container.textContent).toContain("API node check.mjs");
		// The brief and the card's checklist carry the criteria; More has Edit plan.
		expect(container.textContent).not.toContain("Search finds titles");
		expect(container.querySelector("input")).toBeNull();
		expect(container.querySelector("button")).toBeNull();
		// The Checks tab lists them once a run has.
		await act(async () => summary(true));
		expect(container.textContent).not.toContain("node check.mjs");
	});

	it("names each criterion and check in its controls", async () => {
		await render(
			factoryTaskConfigSchema.parse({
				checks: [{ name: "API", command: "node check.mjs", kind: "api" }],
				acceptanceCriteria: [{ id: "c1", text: "Search", check: "API" }],
			}),
		);
		expect(
			container.querySelector('input[aria-label="Criterion c1"]'),
		).not.toBeNull();
		expect(
			container.querySelector('button[aria-label="Remove check API"]'),
		).not.toBeNull();
	});
});

describe("Verification setup", () => {
	const hash = "e".repeat(64);
	const profile = {
		schemaVersion: 1,
		environment: {
			setup: "bun install",
			start: "bun run dev --port $FACTORY_APP_PORT",
			healthcheck: "curl -fsS $FACTORY_APP_URL",
			cleanup: "pkill -f vite",
		},
		exercise: "Open /notes and search for a title.",
		artifacts: [],
	};
	const withProfile = (
		origin: "repository" | "approved_local" | "proposed",
		extra: Record<string, unknown> = {},
	) =>
		factoryTaskConfigSchema.parse({
			verificationProfile: { profile, hash, origin },
			...extra,
		});
	const show = (
		config: FactoryTaskConfig,
		dryRun?: Parameters<typeof FactoryVerificationSetup>[0]["dryRun"],
		hasVerifier = true,
	) =>
		act(async () =>
			root.render(
				<FactoryVerificationSetup
					config={config}
					dryRun={dryRun}
					hasVerifier={hasVerifier}
				/>,
			),
		);
	const block = () => container.querySelector('[aria-label="Test setup"]');

	it("shows where the setup came from, its commands, short hash and collapsed exercise notes", async () => {
		await show(withProfile("repository"), {
			hash,
			preflight: "passed",
		});
		const text = block()?.textContent ?? "";
		expect(text).toContain("From the repository");
		expect(text).toContain(hash.slice(0, 12));
		expect(text).not.toContain(hash);
		expect(text).toContain("Setupbun install");
		expect(text).toContain("Startbun run dev --port $FACTORY_APP_PORT");
		expect(text).toContain("Health checkcurl -fsS $FACTORY_APP_URL");
		expect(text).toContain("Cleanuppkill -f vite");
		expect(block()?.querySelector("code")?.className).toContain("font-mono");
		expect(text).toContain("Dry run passed");
		const exercise = block()?.querySelector("details");
		expect(exercise?.open).toBe(false);
		expect(exercise?.textContent).toContain("Open /notes");

		await show(withProfile("approved_local"));
		expect(block()?.textContent).toContain("Approved earlier on this machine");
		expect(block()?.textContent).toContain("Not tried yet");
		await show(withProfile("proposed"));
		expect(block()?.textContent).toContain(
			"Proposed by this plan: reviewed before it runs",
		);
	});

	it("names the failed dry-run stage and keeps its log behind Show log", async () => {
		await show(withProfile("proposed"), {
			hash,
			preflight: "failed",
			stage: "healthcheck",
			detail: "curl: (7) Failed to connect",
		});
		expect(block()?.textContent).toContain("Dry run failed at healthcheck");
		const log = Array.from(block()?.querySelectorAll("details") ?? []).find(
			(item) => item.querySelector("summary")?.textContent === "Show log",
		);
		expect(log?.open).toBe(false);
		expect(log?.textContent).toContain("Failed to connect");
		// A dry run of another version of the setup does not apply.
		await show(withProfile("proposed"), {
			hash: "f".repeat(64),
			preflight: "failed",
		});
		expect(block()?.textContent).not.toContain("Dry run failed");
	});

	it("says when the workflow's own app environment overrides the repository setup", async () => {
		await show(
			withProfile("repository", {
				agents: { verifier: { environment: { start: "make serve" } } },
			}),
		);
		expect(block()?.textContent).toContain(
			"overrides the repository's test setup",
		);
		await show(withProfile("repository", { agents: { verifier: {} } }));
		expect(block()?.textContent).not.toContain("overrides");
	});

	it("keeps the no-verification note and says Factory proposes one when needed", async () => {
		await show(factoryTaskConfigSchema.parse({}), undefined, false);
		expect(container.textContent).toContain("No test setup.");
		expect(container.textContent).toContain(
			"Factory proposes a test setup when a plan needs one.",
		);
		await show(factoryTaskConfigSchema.parse({}), undefined, true);
		expect(container.textContent).toBe("");
	});
});

describe("Check editor", () => {
	it("captions every field, keeps the two remove actions apart and gives the command several lines", async () => {
		const long =
			`cd apps/backend/core-api && go test ./internal/... ${"-run Something ".repeat(8)}`.trim();
		await render(
			factoryTaskConfigSchema.parse({
				checks: [
					{
						name: "API",
						command: long,
						kind: "api",
						artifacts: ["logs/api.log"],
					},
				],
			}),
		);
		const editor = container.querySelector(
			'[data-testid="factory-check-editor"]',
		);
		if (!editor) throw new Error("Missing check editor");
		// Visible captions, not just accessible names.
		const captions = [...editor.querySelectorAll("label, legend")].map(
			(item) => item.firstChild?.textContent,
		);
		expect(captions).toEqual(
			expect.arrayContaining([
				"Check name",
				"Check type",
				"Check command",
				"Evidence files",
			]),
		);
		// The command is a multi-line monospace field sized to its text.
		const command = editor.querySelector<HTMLTextAreaElement>(
			'textarea[aria-label="Check command"]',
		);
		expect(command?.value).toBe(long);
		expect(command?.className).toContain("font-mono");
		expect(command?.rows).toBeGreaterThan(1);
		expect(
			editor.querySelector('input[aria-label="Check command"]'),
		).toBeNull();
		// Evidence paths sit in their own captioned group, apart from the
		// command, with their own remove buttons.
		const paths = editor.querySelector(
			'[data-testid="factory-evidence-paths"]',
		);
		expect(paths?.tagName).toBe("FIELDSET");
		expect(paths?.textContent).toContain("relative to the worktree");
		expect(
			paths?.querySelector('input[aria-label="Evidence path"]'),
		).not.toBeNull();
		expect(
			paths?.querySelector(
				'button[aria-label="Remove evidence path logs/api.log"]',
			),
		).not.toBeNull();
		const removeCheck = editor.querySelector(
			'button[aria-label="Remove check API"]',
		);
		expect(removeCheck?.textContent).toBe("Remove check");
		expect(paths?.contains(removeCheck as Node)).toBe(false);
	});
});
