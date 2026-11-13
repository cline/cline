"use client";

import { Check, X } from "lucide-react";
import {
	FACTORY_STATIONS,
	type FactoryStation,
	type FactoryStationState,
} from "@/lib/factory-attention";
import { FACTORY_LINE } from "@/lib/factory-copy";
import { cn } from "@/lib/utils";
import { type FactoryTone, toneStatusText } from "./factory-ui";

export {
	FACTORY_STATIONS,
	type FactoryStation,
	type FactoryStationOutcome,
	type FactoryStationState,
	factoryStation,
} from "@/lib/factory-attention";

/**
 * How a stage reads for one card: `done` before the card's stage, `current`
 * or `stopped` at it, `upcoming` after it, `skipped` when the plan does not
 * use it (Verify without a tester).
 */
export type FactoryStationLineState =
	| "done"
	| "current"
	| "stopped"
	| "upcoming"
	| "skipped";

export type FactoryLineStation = {
	station: FactoryStation;
	state: FactoryStationLineState;
};

/** The five stages a card moves through; Waiting comes before them. */
const FACTORY_STAGES: readonly FactoryStation[] = FACTORY_STATIONS.filter(
	(station) => station !== "waiting",
);

/**
 * One card's stages: done before its stage, current (or stopped) at it,
 * upcoming after, and the stages its plan skips. A waiting card has every
 * stage ahead of it.
 */
export function factoryCardStations(
	state: FactoryStationState,
): FactoryLineStation[] {
	const at = FACTORY_STAGES.indexOf(state.station);
	return FACTORY_STAGES.map((station, index) => ({
		station,
		state:
			index === at
				? state.stopped
					? "stopped"
					: state.station === "delivered"
						? "done"
						: "current"
				: state.skipped.includes(station)
					? "skipped"
					: at !== -1 && index < at
						? "done"
						: "upcoming",
	}));
}

type ShownState = Exclude<FactoryStationLineState, "skipped">;

const STEP_LABEL: Record<ShownState, string> = {
	done: "text-muted-foreground",
	current: "font-medium text-foreground",
	stopped: "font-medium text-error-text",
	upcoming: "text-muted-foreground/70",
};

function StepIcon({ state }: { state: ShownState }) {
	const className = "mr-1.5 shrink-0";
	if (state === "done")
		return (
			<Check
				aria-hidden
				className={cn(className, "size-3 text-muted-foreground")}
			/>
		);
	if (state === "stopped")
		return (
			<X aria-hidden className={cn(className, "size-3 text-error-text")} />
		);
	return (
		<span
			aria-hidden
			className={cn(
				className,
				"size-2 rounded-full",
				state === "current"
					? "bg-foreground"
					: "border border-muted-foreground/50",
			)}
		/>
	);
}

/** How a stopped card's stop is named on its line and rows. */
export function factoryStoppedLabel(
	state: Pick<FactoryStationState, "station" | "publishFailed">,
): string {
	return state.publishFailed
		? FACTORY_LINE.stoppedOpeningPr
		: FACTORY_LINE.stoppedAt(FACTORY_LINE.stations[state.station]);
}

/**
 * A card's stages as a stepper (done, current or stopped, upcoming), joined
 * by short rules, with skipped stages left out: the card header's form.
 */
export function FactoryStationLine({
	stations,
	stoppedLabel,
	className,
	"aria-label": label,
}: {
	stations: readonly FactoryLineStation[];
	/** The stop's name, from `factoryStoppedLabel`; "Stopped at …" by default. */
	stoppedLabel?: string;
	className?: string;
	"aria-label": string;
}) {
	const shown = stations.filter(
		(station): station is FactoryLineStation & { state: ShownState } =>
			station.state !== "skipped",
	);
	return (
		<section aria-label={label} data-factory-line-root className={className}>
			<ol
				data-factory-line="compact"
				className="flex flex-wrap items-center gap-y-1 text-xs"
			>
				{/* Each connector trails its step, so a wrapped line never
				    starts with one. */}
				{shown.map((station, index) => (
					<li
						key={station.station}
						data-factory-station={station.station}
						data-state={station.state}
						aria-current={
							station.state === "current" || station.state === "stopped"
								? "step"
								: undefined
						}
						className="flex items-center whitespace-nowrap"
					>
						<StepIcon state={station.state} />
						<span className={STEP_LABEL[station.state]}>
							{FACTORY_LINE.stations[station.station]}
							{station.state === "stopped" ? (
								<span className="sr-only">
									,{" "}
									{stoppedLabel ??
										FACTORY_LINE.stoppedAt(
											FACTORY_LINE.stations[station.station],
										)}
								</span>
							) : null}
						</span>
						{index < shown.length - 1 ? (
							<span aria-hidden className="mx-1.5 h-px w-2.5 bg-border" />
						) : null}
					</li>
				))}
			</ol>
		</section>
	);
}

/** The current stage's colour, by the card's tone. */
const CURRENT_SEGMENT: Record<FactoryTone, string> = {
	neutral: "bg-muted-foreground",
	attention: "bg-amber-500",
	working: "bg-sky-500",
	success: "bg-emerald-500",
	danger: "bg-destructive",
	accent: "bg-primary",
};

/**
 * The small stage line on a home or rail row: five short segments and the
 * stage's name. The segments are an image with a spoken label, and colour is
 * never the only signal: the name, and the row's icon, say the same.
 * `segmentsClassName` lets a narrow row hide the segments and keep the name.
 */
export function FactoryRowStages({
	state,
	tone,
	className,
	segmentsClassName,
}: {
	state: FactoryStationState;
	tone: FactoryTone;
	className?: string;
	segmentsClassName?: string;
}) {
	const stages = factoryCardStations(state);
	const name = FACTORY_LINE.stations[state.station];
	const index = FACTORY_STAGES.indexOf(state.station) + 1;
	return (
		<span
			data-factory-stages={state.station}
			data-state={state.stopped ? "stopped" : undefined}
			className={cn(
				"flex min-w-0 items-center gap-2 text-xs whitespace-nowrap",
				toneStatusText(tone),
				className,
			)}
		>
			<span
				role="img"
				aria-label={
					state.stopped
						? factoryStoppedLabel(state)
						: FACTORY_LINE.stage(name, index, FACTORY_STAGES.length)
				}
				className={cn("flex shrink-0 gap-0.5", segmentsClassName)}
			>
				{stages.map((stage) => (
					<span
						key={stage.station}
						data-factory-segment={stage.station}
						data-state={stage.state}
						title={
							stage.state === "skipped"
								? `${FACTORY_LINE.stations[stage.station]}: ${FACTORY_LINE.skippedForCard}`
								: undefined
						}
						className={cn(
							"block w-3 rounded-[1px]",
							stage.state === "skipped"
								? "mt-px h-px border-t border-dashed border-muted-foreground/50"
								: "h-1",
							stage.state === "done" && "bg-muted-foreground/60",
							stage.state === "upcoming" && "bg-muted-foreground/20",
							stage.state === "stopped" && "bg-destructive",
							stage.state === "current" && CURRENT_SEGMENT[tone],
						)}
					/>
				))}
			</span>
			<span aria-hidden className="truncate">
				{name}
			</span>
		</span>
	);
}
