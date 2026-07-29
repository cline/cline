import type { TeamTask, TeamTaskStatus } from "../team/types";

export type DependencyNode = TeamTask & {
	key: string;
	teamId: string;
	dependsOnKeys: string[];
	dependentKeys: string[];
	missingDependencies: string[];
	isReady: boolean;
	isWaiting: boolean;
	inCycle: boolean;
	layer: number;
};

export type DependencyMap = {
	nodes: DependencyNode[];
	cycles: string[][];
	missingReferences: string[];
	counts: Record<TeamTaskStatus, number>;
};

const compare = (a: DependencyNode, b: DependencyNode) =>
	a.layer - b.layer ||
	a.title.localeCompare(b.title) ||
	a.key.localeCompare(b.key);

export function buildDependencyMap(
	teams: Array<{ teamId: string; tasks: TeamTask[] }>,
): DependencyMap {
	const nodes: DependencyNode[] = teams.flatMap(({ teamId, tasks }) =>
		tasks.map((task) => ({
			...task,
			teamId,
			key: `${teamId}:${task.id}`,
			dependsOnKeys: [],
			dependentKeys: [],
			missingDependencies: [],
			isReady: false,
			isWaiting: false,
			inCycle: false,
			layer: 0,
		})),
	);
	const byKey = new Map(nodes.map((node) => [node.key, node]));
	const byTeamTask = new Map(
		nodes.map((node) => [`${node.teamId}:${node.id}`, node]),
	);
	for (const node of nodes)
		for (const id of node.dependsOn) {
			const prerequisite =
				byTeamTask.get(`${node.teamId}:${id}`) ?? byKey.get(id);
			if (!prerequisite) node.missingDependencies.push(id);
			else {
				node.dependsOnKeys.push(prerequisite.key);
				prerequisite.dependentKeys.push(node.key);
			}
		}
	const color = new Map<string, 0 | 1 | 2>();
	const stack: string[] = [];
	const cycles: string[][] = [];
	const visit = (node: DependencyNode) => {
		color.set(node.key, 1);
		stack.push(node.key);
		for (const key of node.dependsOnKeys) {
			const next = byKey.get(key)!;
			if (color.get(key) === 1) {
				const cycle = stack.slice(stack.indexOf(key));
				cycles.push(cycle);
				cycle.forEach((k) => {
					byKey.get(k)!.inCycle = true;
				});
			} else if (color.get(key) !== 2) visit(next);
		}
		stack.pop();
		color.set(node.key, 2);
	};
	nodes.forEach((node) => {
		if (!color.get(node.key)) visit(node);
	});
	const layer = (node: DependencyNode, seen = new Set<string>()): number => {
		if (node.inCycle || seen.has(node.key)) return 0;
		seen.add(node.key);
		return node.dependsOnKeys.reduce(
			(max, key) => Math.max(max, layer(byKey.get(key)!, new Set(seen)) + 1),
			0,
		);
	};
	for (const node of nodes) {
		node.layer = layer(node);
		const pending = node.dependsOnKeys
			.map((k) => byKey.get(k)!)
			.filter((n) => n.status !== "completed");
		node.isWaiting =
			node.status === "pending" &&
			(pending.length > 0 ||
				node.missingDependencies.length > 0 ||
				node.inCycle);
		node.isReady = node.status === "pending" && !node.isWaiting;
	}
	const counts: Record<TeamTaskStatus, number> = {
		pending: 0,
		in_progress: 0,
		blocked: 0,
		completed: 0,
	};
	for (const n of nodes) {
		counts[n.status]++;
	}
	return {
		nodes: nodes.sort(compare),
		cycles,
		missingReferences: nodes.flatMap((n) =>
			n.missingDependencies.map((id) => `${n.key} -> ${id}`),
		),
		counts,
	};
}
