import { PauseIcon, PlayIcon, RotateCcwIcon, SkipBackIcon, SkipForwardIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CommandBadge, PageFrame, PageHeader } from "../components/views/page-layout";
import {
	projectShareScreenDemo,
	SHARE_SCREEN_DEMO_FIXTURE,
} from "./demoFixture";
import { Spotlight } from "./Spotlight";

const LOOP_TICK_MS = 2200;

function clampBeatCursor(cursor: number, totalBeats: number): number {
	if (totalBeats <= 0) {
		return 0;
	}
	if (cursor < 0) {
		return totalBeats - 1;
	}
	if (cursor >= totalBeats) {
		return 0;
	}
	return cursor;
}

export function ShareScreenSpotlightDemo() {
	const [beatCursor, setBeatCursor] = useState(0);
	const [playing, setPlaying] = useState(true);
	const [spotlightOverride, setSpotlightOverride] = useState<
		"fixture" | "human" | "agent"
	>("fixture");

	const projection = useMemo(
		() => projectShareScreenDemo({ beatCursor, spotlightOverride }),
		[beatCursor, spotlightOverride],
	);

	useEffect(() => {
		if (!playing || projection.totalBeats <= 1) {
			return;
		}
		const timer = window.setInterval(() => {
			setBeatCursor((current) =>
				clampBeatCursor(current + 1, projection.totalBeats),
			);
		}, LOOP_TICK_MS);
		return () => window.clearInterval(timer);
	}, [playing, projection.totalBeats]);

	const stageSharer = projection.stage.sharer?.kind ?? "agent";
	const sharerLabel =
		stageSharer === "human"
			? SHARE_SCREEN_DEMO_FIXTURE.humanLabel
			: SHARE_SCREEN_DEMO_FIXTURE.agentLabel;

	return (
		<PageFrame className="h-full" contentClassName="max-w-none">
			<PageHeader
				title="Share-screen Spotlight demo"
				description="Simulated-live Drivemode share-screen loop driven by a scripted fixture. No LLM credential required."
				actions={
					<>
						<CommandBadge>/drive?demoShareScreen=1</CommandBadge>
						<Badge variant="outline">DirectorScript fixture</Badge>
					</>
				}
			/>
			<div className="mb-4 grid gap-3 rounded-lg border bg-card p-4">
				<div className="flex flex-wrap items-center gap-2">
					<Button
						onClick={() => setPlaying((current) => !current)}
						size="sm"
						type="button"
						variant={playing ? "secondary" : "default"}
					>
						{playing ? (
							<>
								<PauseIcon className="size-4" />
								Pause loop
							</>
						) : (
							<>
								<PlayIcon className="size-4" />
								Play loop
							</>
						)}
					</Button>
					<Button
						onClick={() =>
							setBeatCursor((current) =>
								clampBeatCursor(current - 1, projection.totalBeats),
							)
						}
						size="sm"
						type="button"
						variant="outline"
					>
						<SkipBackIcon className="size-4" />
						Previous beat
					</Button>
					<Button
						onClick={() =>
							setBeatCursor((current) =>
								clampBeatCursor(current + 1, projection.totalBeats),
							)
						}
						size="sm"
						type="button"
						variant="outline"
					>
						<SkipForwardIcon className="size-4" />
						Next beat
					</Button>
					<Button
						onClick={() => {
							setBeatCursor(0);
							setSpotlightOverride("fixture");
						}}
						size="sm"
						type="button"
						variant="ghost"
					>
						<RotateCcwIcon className="size-4" />
						Restart script
					</Button>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button
						onClick={() => setSpotlightOverride("fixture")}
						size="sm"
						type="button"
						variant={spotlightOverride === "fixture" ? "default" : "outline"}
					>
						Follow script spotlight
					</Button>
					<Button
						onClick={() => setSpotlightOverride("human")}
						size="sm"
						type="button"
						variant={spotlightOverride === "human" ? "default" : "outline"}
					>
						Human takes spotlight
					</Button>
					<Button
						onClick={() => setSpotlightOverride("agent")}
						size="sm"
						type="button"
						variant={spotlightOverride === "agent" ? "default" : "outline"}
					>
						Agent keeps spotlight
					</Button>
				</div>
				<div className="rounded-md border bg-background p-3">
					<p className="text-xs uppercase tracking-wide text-muted-foreground">
						Narration
					</p>
					<p className="mt-1 text-sm text-foreground">{projection.narration}</p>
					<p className="mt-2 text-xs text-muted-foreground">
						Beat {projection.beatCursor + 1}/{projection.totalBeats} ·{" "}
						{projection.beatId} · spotlight: {stageSharer}
					</p>
				</div>
			</div>
			<div className="h-[66vh] min-h-[420px] overflow-hidden rounded-lg border bg-card">
				<Spotlight
					cards={projection.stage.cards}
					demo
					emptyHint="No scripted work events yet. Advance the loop to surface cards."
					humanPin={
						projection.stage.pin
							? {
									kind: projection.stage.pin.kind,
									label: projection.stage.pin.label,
									ref: projection.stage.pin.ref,
								}
							: null
					}
					humanSharing={stageSharer === "human"}
					nextLabel={projection.nextLabel}
					nowLabel={projection.nowLabel}
					sharerLabel={sharerLabel}
					className="h-full border-l-0"
				/>
			</div>
		</PageFrame>
	);
}
