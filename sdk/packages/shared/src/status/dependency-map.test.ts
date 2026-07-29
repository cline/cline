import { describe, expect, it } from "vitest";
import type { TeamTask } from "../team/types";
import { buildDependencyMap } from "./dependency-map";
const task = (
	id: string,
	dependsOn: string[] = [],
	status: TeamTask["status"] = "pending",
): TeamTask => ({
	id,
	title: id,
	description: "",
	status,
	createdAt: new Date(),
	updatedAt: new Date(),
	createdBy: "lead",
	dependsOn,
});
describe("buildDependencyMap", () => {
	it("layers chains and fan-in deterministically while identifying ready work", () => {
		const map = buildDependencyMap([
			{
				teamId: "t",
				tasks: [
					task("deploy", ["api", "web"]),
					task("web"),
					task("api", ["schema"]),
					task("schema", [], "completed"),
				],
			},
		]);
		expect(map.nodes.map((n) => [n.id, n.layer])).toEqual([
			["schema", 0],
			["web", 0],
			["api", 1],
			["deploy", 2],
		]);
		expect(map.nodes.find((n) => n.id === "web")?.isReady).toBe(true);
		expect(map.nodes.find((n) => n.id === "api")?.isReady).toBe(true);
		expect(map.nodes.find((n) => n.id === "deploy")?.isWaiting).toBe(true);
	});
	it("reports missing references and direct and indirect cycles", () => {
		const map = buildDependencyMap([
			{
				teamId: "t",
				tasks: [
					task("missing", ["nope"]),
					task("a", ["b"]),
					task("b", ["c"]),
					task("c", ["a"]),
					task("self", ["self"]),
				],
			},
		]);
		expect(map.missingReferences).toEqual(["t:missing -> nope"]);
		expect(map.cycles).toHaveLength(2);
		expect(map.nodes.filter((n) => n.inCycle).map((n) => n.id)).toEqual([
			"a",
			"b",
			"c",
			"self",
		]);
		expect(map.nodes.find((n) => n.id === "missing")?.isWaiting).toBe(true);
	});
});
