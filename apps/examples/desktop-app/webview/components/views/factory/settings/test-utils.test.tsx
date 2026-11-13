// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FactoryProjects } from "@/lib/factory-settings-client";
import { settingsPage as limits } from "./pages/limits";
import { settingsPage as stages } from "./pages/stages";
import { click, deadRows, renderSettingsPage, resource } from "./test-utils";

vi.mock("@/components/ui/select", async () =>
	(await import("./test-utils")).nativeSelectModule(),
);
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: {
		invoke: vi.fn(async () => ({ file: "absent", stages: [] })),
	},
}));

let unmount: (() => Promise<void>) | undefined;
afterEach(async () => {
	await unmount?.();
	unmount = undefined;
});

describe("renderSettingsPage", () => {
	it("renders a page with a fake shell and finds its rows", async () => {
		const page = await renderSettingsPage(limits, {
			shell: {
				limits: {
					limits: {
						supported: true,
						concurrency: 2,
						paused: true,
						dailyCostUsd: 50,
					},
					loading: false,
					saving: false,
					error: null,
					errorFor: null,
					setConcurrency: vi.fn(),
					setDailyCostUsd: vi.fn(),
					setPaused: vi.fn(),
				} as never,
			},
		});
		unmount = page.unmount;
		expect(page.row("concurrency")).not.toBeNull();
		expect(deadRows(page.container)).toEqual([]);
		await click(page.buttons("Resume")[0]);
		expect(page.shell.limits.setPaused).toHaveBeenCalledWith(false);
	});

	it("gives badge hooks the shared projects summary", async () => {
		const page = await renderSettingsPage(stages, {
			shell: {
				projectsSummary: resource<FactoryProjects>({
					projects: [
						{
							workspaceRoot: "/work/app",
							name: "app",
							stages: { file: "present", total: 2, inUse: 1, awaiting: 1 },
							verification: "none",
							guidance: { roles: [], changed: [] },
							taskFiles: 0,
						},
					],
					userGuidanceChanged: [],
				}),
			},
		});
		unmount = page.unmount;
		expect(stages.useBadge).toBeDefined();
		expect(page.text()).toContain("Stages");
	});
});
