import type { TeamTask } from "@cline/shared";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { buildDependencyMap } from "./dependency-map-model";

type Team = { teamId: string; teamName: string; tasks: TeamTask[] };

export function DependencyMap({
	teams,
	loading,
}: {
	teams: Team[];
	loading: boolean;
}) {
	const graph = useMemo(() => buildDependencyMap(teams), [teams]);
	const [selected, setSelected] = useState<string | null>(null);
	const selectedNode = graph.nodes.find((node) => node.key === selected);
	const move = (delta: number) => {
		const current = Math.max(
			0,
			graph.nodes.findIndex((node) => node.key === selected),
		);
		const next =
			graph.nodes[(current + delta + graph.nodes.length) % graph.nodes.length];
		if (!next) return;
		setSelected(next.key);
		document.getElementById(`dependency-${CSS.escape(next.key)}`)?.focus();
	};
	if (loading)
		return (
			<p className="text-sm text-muted-foreground" role="status">
				Loading dependency map…
			</p>
		);
	if (!graph.nodes.length)
		return (
			<div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
				No active team tasks are available. Dependency maps appear when a team
				session is active.
			</div>
		);
	return (
		<section aria-labelledby="dependency-map-heading" className="space-y-3">
			<div>
				<h2 id="dependency-map-heading" className="text-base font-semibold">
					Dependency map
				</h2>
				<p className="text-xs text-muted-foreground">
					{graph.nodes.length} tasks; {graph.counts.blocked} blocked;{" "}
					{graph.nodes.filter((node) => node.isReady).length} ready. Use Tab,
					then arrow keys to review tasks; Enter or Space shows details.
				</p>
			</div>
			{graph.cycles.length || graph.missingReferences.length ? (
				<div
					className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm"
					role="alert"
				>
					<strong>Dependency integrity warning.</strong>
					{graph.cycles.length
						? ` ${graph.cycles.length} cycle${graph.cycles.length === 1 ? "" : "s"} detected.`
						: ""}
					{graph.missingReferences.length
						? ` ${graph.missingReferences.length} missing reference${graph.missingReferences.length === 1 ? "" : "s"} detected.`
						: ""}
				</div>
			) : null}
			<ul
				aria-label="Tasks in dependency order"
				className="grid gap-2 md:grid-cols-2"
				onKeyDown={(event) => {
					if (
						event.altKey ||
						event.ctrlKey ||
						event.metaKey ||
						event.nativeEvent.isComposing
					)
						return;
					if (event.key === "ArrowDown" || event.key === "ArrowRight") {
						event.preventDefault();
						move(1);
					}
					if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
						event.preventDefault();
						move(-1);
					}
					if (event.key === "Home") {
						event.preventDefault();
						setSelected(graph.nodes[0]!.key);
					}
					if (event.key === "End") {
						event.preventDefault();
						setSelected(graph.nodes.at(-1)!.key);
					}
					if (event.key === "Escape") {
						event.preventDefault();
						setSelected(null);
					}
				}}
			>
				{graph.nodes.map((node) => (
					<li key={node.key}>
						<button
							aria-pressed={selected === node.key}
							className={cn(
								"w-full rounded-lg border p-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
								selected === node.key && "border-primary bg-accent",
							)}
							id={`dependency-${node.key}`}
							onClick={() => setSelected(node.key)}
							type="button"
						>
							<span className="block font-medium">{node.title}</span>
							<span className="block text-xs text-muted-foreground">
								{node.status.replace("_", " ")} · Layer {node.layer}
								{node.isReady ? " · Ready" : ""}
								{node.isWaiting ? " · Waiting on prerequisites" : ""}
								{node.inCycle ? " · Cycle" : ""}
							</span>
						</button>
					</li>
				))}
			</ul>
			{selectedNode ? (
				<aside aria-live="polite" className="rounded-lg border bg-card p-3">
					<h3 className="font-medium">{selectedNode.title}</h3>
					<p className="text-sm text-muted-foreground">
						Blocked by:{" "}
						{selectedNode.dependsOnKeys.length
							? selectedNode.dependsOnKeys
									.map(
										(key) =>
											graph.nodes.find((node) => node.key === key)?.title ??
											key,
									)
									.join(", ")
							: "Nothing"}
						. Unblocks:{" "}
						{selectedNode.dependentKeys.length
							? selectedNode.dependentKeys
									.map(
										(key) =>
											graph.nodes.find((node) => node.key === key)?.title ??
											key,
									)
									.join(", ")
							: "Nothing"}
						.
					</p>
				</aside>
			) : null}
		</section>
	);
}
