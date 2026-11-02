import { afterEach, describe, expect, it, vi } from "vitest";
import {
	installMarketplaceItem,
	listMarketplaceInstalledItems,
	type MarketplaceEntry,
	uninstallMarketplaceItem,
} from "./marketplace";

const mocks = vi.hoisted(() => ({
	install: vi.fn(),
	delete: vi.fn(),
	list: vi.fn(),
	invoke: vi.fn(),
}));
const skills = vi.hoisted(() => ({
	install: vi.fn(),
	uninstall: vi.fn(),
	status: vi.fn(),
}));
vi.mock("./hub-client", () => ({ hubMcp: mocks, hubSkills: skills }));
vi.mock("./desktop-client", () => ({
	desktopClient: { invoke: mocks.invoke },
}));
afterEach(() => vi.resetAllMocks());
const entry = (type: "mcp" | "skill" | "plugin") =>
	({
		id: "entry",
		name: "Entry",
		type,
		install: { args: ["server", "--", "node"], command: "cline" },
	}) as MarketplaceEntry;
describe("Marketplace MCP direct Hub actions", () => {
	it("installs and removes standalone MCP entries through the local Hub", async () => {
		mocks.install.mockResolvedValue({ warnings: ["note"] });
		expect(await installMarketplaceItem(entry("mcp"))).toMatchObject({
			status: "installed",
			output: "note",
		});
		expect(mocks.install).toHaveBeenCalledWith(["server", "--", "node"]);
		await uninstallMarketplaceItem(entry("mcp"));
		expect(mocks.delete).toHaveBeenCalledWith("server");
		expect(mocks.invoke).not.toHaveBeenCalled();
	});
	it("composes installed state without forwarding MCP entries to the sidecar", async () => {
		mocks.list.mockResolvedValue({ servers: [{ name: "server" }] });
		mocks.invoke.mockResolvedValue({ installedKeys: ["plugin:entry"] });
		skills.status.mockResolvedValue({ installedIds: ["entry"] });
		expect(
			await listMarketplaceInstalledItems([
				entry("mcp"),
				entry("skill"),
				entry("plugin"),
			]),
		).toEqual({ installedKeys: ["plugin:entry", "skill:entry", "mcp:entry"] });
		expect(mocks.invoke).toHaveBeenCalledWith(
			"list_marketplace_installed_entries",
			{ entries: [entry("plugin")] },
		);
	});
	it("sends only canonical catalog IDs for skill mutations", async () => {
		skills.install.mockResolvedValue({ status: "installed" });
		await installMarketplaceItem(entry("skill"));
		await uninstallMarketplaceItem(entry("skill"));
		expect(skills.install).toHaveBeenCalledWith("entry");
		expect(skills.uninstall).toHaveBeenCalledWith("entry");
		expect(mocks.invoke).not.toHaveBeenCalled();
	});
});
