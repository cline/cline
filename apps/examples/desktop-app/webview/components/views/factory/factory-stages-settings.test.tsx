// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { desktopClient } from "@/lib/desktop-client";
import {
	FactoryStagesSettings,
	useFactoryStages,
} from "./factory-stages-settings";

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: vi.fn() },
}));
const invoke = vi.mocked(desktopClient.invoke);

const hash = "a".repeat(64);
const stage = {
	id: "no-todo-left",
	name: "No TODO left",
	kind: "command",
	command: "! git diff | grep TODO",
	when: { paths: ["src/**"] },
};
const listing = (status: string) => ({
	file: "present",
	stages: [{ stage, hash, status }],
});

/** The settings page's use: one read per project, one project shown. */
function Stages({ roots }: { roots: string[] }) {
	const stages = useFactoryStages(roots);
	return (
		<>
			<output data-awaiting>{stages.awaiting}</output>
			{roots.map((root) => (
				<FactoryStagesSettings
					key={root}
					workspaceRoot={root}
					stages={stages}
				/>
			))}
		</>
	);
}

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	invoke.mockReset();
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("FactoryStagesSettings", () => {
	it("shows a stage as a row and approves exactly the definition shown", async () => {
		invoke.mockImplementation(async (command: string) =>
			command === "factory_get_stages"
				? listing("needs_approval")
				: listing("approved"),
		);
		await act(async () => root.render(<Stages roots={["/work/app"]} />));
		expect(invoke).toHaveBeenCalledTimes(1);
		expect(invoke).toHaveBeenCalledWith("factory_get_stages", {
			workspaceRoot: "/work/app",
		});
		expect(container.querySelector("[data-awaiting]")?.textContent).toBe("1");
		const row = container.querySelector('[data-status="needs_approval"]');
		// Awaiting a decision, the definition starts open.
		expect(
			row?.querySelector("[aria-expanded]")?.getAttribute("aria-expanded"),
		).toBe("true");
		expect(row?.textContent).toContain("No TODO left");
		expect(row?.textContent).toContain("Command · files matching src/**");
		expect(row?.textContent).toContain("Needs approval");
		expect(row?.textContent).toContain(stage.command);
		const approve = [...container.querySelectorAll("button")].find(
			(button) => button.textContent === "Approve",
		);
		await act(async () => approve?.click());
		expect(invoke).toHaveBeenLastCalledWith("factory_decide_stage", {
			workspaceRoot: "/work/app",
			stageId: stage.id,
			expectedHash: hash,
			decision: "approved",
		});
		const approved = container.querySelector('[data-status="approved"]');
		// Approved, the definition folds away again on request.
		expect(approved?.textContent).not.toContain("Once approved");
		expect(approved?.textContent).toContain("In use");
		expect(approved?.textContent).toContain("Stop using");
		expect(container.querySelector("[data-awaiting]")?.textContent).toBe("0");
		expect(
			approved?.querySelector("[aria-expanded]")?.getAttribute("aria-expanded"),
		).toBe("true");
	});

	it("shows everything Approve trusts, expanded, on every row Approve is offered", async () => {
		const full = {
			...stage,
			blocking: false,
			timeoutSeconds: 120,
			artifacts: ["reports/todo.txt"],
		};
		invoke.mockResolvedValue({
			file: "present",
			stages: [
				{ stage: full, hash, status: "declined" },
				{ stage: { ...full, id: "changed" }, hash, status: "changed" },
			],
		});
		await act(async () => root.render(<Stages roots={["/work/app"]} />));
		for (const status of ["declined", "changed"]) {
			const row = container.querySelector(`[data-status="${status}"]`);
			expect(row?.textContent).toContain("Approve");
			const definition = row?.querySelector("pre");
			expect(definition?.hidden).toBe(false);
			// The canonical JSON the hash covers, not only the command.
			expect(JSON.parse(definition?.textContent ?? "")).toMatchObject({
				command: full.command,
				timeoutSeconds: 120,
				artifacts: ["reports/todo.txt"],
				blocking: false,
				when: { paths: ["src/**"] },
			});
			expect(row?.textContent).toContain("as you, with access to your files");
		}
	});

	it("says when a project has no stages, an invalid file, or the Hub cannot run them", async () => {
		invoke.mockImplementation(async (_command: string, args?: unknown) =>
			(args as { workspaceRoot: string }).workspaceRoot === "/a"
				? { file: "absent", stages: [] }
				: { file: "invalid", reason: "bad JSON", stages: [] },
		);
		await act(async () => root.render(<Stages roots={["/a", "/b"]} />));
		expect(container.textContent).toContain(
			"No repository stages in this project. Ask Factory to add one.",
		);
		expect(container.textContent).toContain("stages.json is invalid: bad JSON");
		invoke.mockResolvedValue({ supported: false });
		await act(async () => root.render(<Stages roots={["/c"]} />));
		expect(container.textContent).toContain(
			"This Factory version cannot run repository stages.",
		);
	});
});
