type CompanionDance = {
	id: string;
	name: string;
	src: string;
	durations: readonly number[];
};

// Each sprite is a locally bundled horizontal strip of 56px square drawings,
// displayed at 28 CSS pixels. Durations are authored holds, in milliseconds.
export const COMPANION_DANCES = [
	{
		id: "mr-robot",
		name: "Mr. Robot",
		src: "/cline-companion/cline-mr-robot-56-strip.webp",
		durations: [
			140, 110, 90, 90, 100, 230, 110, 90, 90, 90, 100, 230, 100, 90, 90, 190,
			100, 150, 100, 90, 90, 90, 100, 140, 100, 100, 110, 100, 110, 200, 100,
			90, 100, 110, 120, 240,
		],
	},
	{
		id: "shuffle",
		name: "Cline Shuffle",
		src: "/cline-companion/cline-shuffle-56-strip.webp",
		durations: [
			180, 140, 130, 140, 150, 180, 150, 170, 210, 140, 140, 190, 180, 140, 140,
			140, 160, 180, 150, 170, 210, 150, 150, 210,
		],
	},
	{
		id: "slow-groove",
		name: "Slow Groove",
		src: "/cline-companion/cline-slow-groove-56-strip.webp",
		durations: [
			200, 140, 130, 130, 140, 120, 130, 140, 150, 190, 140, 140, 150, 120, 130,
			150, 190, 140, 140, 170, 120, 120, 130, 130, 130, 140, 170, 170, 160, 140,
			130, 100, 90, 140, 140, 240,
		],
	},
] as const satisfies readonly CompanionDance[];

export function danceKeyframes(durations: readonly number[]): Keyframe[] {
	const total = durations.reduce((sum, duration) => sum + duration, 0);
	const lastFrame = durations.length - 1;
	let elapsed = 0;
	const frames: Keyframe[] = durations.map((duration, frame) => {
		const keyframe = {
			backgroundPosition: `${(frame / lastFrame) * 100}% 0%`,
			offset: elapsed / total,
			easing: "steps(1, end)",
		};
		elapsed += duration;
		return keyframe;
	});
	frames.push({ backgroundPosition: "100% 0%", offset: 1 });
	return frames;
}
