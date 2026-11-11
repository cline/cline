import { Fragment } from "react";

type Point = readonly [number, number];
type Segment = {
	end: Point;
	arc?: readonly [rx: number, ry: number, large: number, sweep: number];
};

// One planar grid keeps mating edges, projected circles, and extrusions aligned.
// Project (u, v) onto 30° isometric axes; depth remains vertical on the screen.
const SIDE = 65.8;
const DEPTH = 20;
const CORNER = 3.2;
const TAB = 8.1;
const MID = SIDE / 2;
const OFFSET = TAB / 2;
const NECK = (TAB * Math.sqrt(3)) / 2;
const FRONT_NECK = TAB / Math.SQRT2;
const COS_30 = Math.sqrt(3) / 2;

function project(u: number, v: number): Point {
	return [(u - v) * COS_30, (u + v) / 2];
}

function circlePoint(center: Point, radius: number, degrees: number): Point {
	const angle = (degrees * Math.PI) / 180;
	return project(
		center[0] + radius * Math.cos(angle),
		center[1] + radius * Math.sin(angle),
	);
}

function line(u: number, v: number): Segment {
	return { end: project(u, v) };
}

function arc(
	center: Point,
	radius: number,
	start: number,
	end: number,
): Segment {
	return {
		end: circlePoint(center, radius, end),
		arc: [
			radius * Math.sqrt(1.5),
			radius / Math.SQRT2,
			Math.abs(end - start) > 180 ? 1 : 0,
			end > start ? 1 : 0,
		],
	};
}

function number(value: number) {
	return Number(value.toFixed(3));
}

function path(segments: Segment[], depth = 0) {
	return segments
		.map(({ end, arc: curve }, index) => {
			const point = `${number(end[0])} ${number(end[1] + depth)}`;
			if (!index) return `M ${point}`;
			return curve
				? `A ${number(curve[0])} ${number(curve[1])} 0 ${curve[2]} ${curve[3]} ${point}`
				: `L ${point}`;
		})
		.join(" ");
}

function reverse(segments: Segment[]): Segment[] {
	return [...segments].reverse().map((segment, index, reversed) => {
		const curve = reversed[index - 1]?.arc;
		return {
			end: segment.end,
			arc: curve ? [curve[0], curve[1], curve[2], 1 - curve[3]] : undefined,
		};
	});
}

function wall(contour: Segment[]) {
	return `${path(contour)} ${path(reverse(contour), DEPTH).replace(/^M/, "L")} Z`;
}

function vertical(point: Point, depth = DEPTH) {
	return `M ${number(point[0])} ${number(point[1])} v ${number(depth)}`;
}

function lowerEdges(contour: Segment[]) {
	return `${path(contour, DEPTH)} ${vertical(contour[0].end)} ${vertical(contour[contour.length - 1].end)}`;
}

const LEFT_CORNER: Point = [CORNER, SIDE - CORNER];
const RIGHT_CORNER: Point = [SIDE - CORNER, CORNER];
const FRONT_CORNER: Point = [SIDE - CORNER, SIDE - CORNER];
const LEFT_TAB: Point = [-OFFSET, MID];
const RIGHT_TAB: Point = [MID, -OFFSET];
const FRONT_TAB: Point = [SIDE + FRONT_NECK, MID];
const LEFT_SOCKET: Point = [MID, SIDE - OFFSET];
const RIGHT_SOCKET: Point = [SIDE - OFFSET, MID];

function pieceGeometry(leftSocket: boolean, rightSocket: boolean) {
	const top = [
		line(CORNER, 0),
		line(MID - NECK, 0),
		arc(RIGHT_TAB, TAB, 150, 390),
		line(SIDE - CORNER, 0),
		arc(RIGHT_CORNER, CORNER, -90, 0),
		line(SIDE, MID - (rightSocket ? NECK : FRONT_NECK)),
		rightSocket
			? arc(RIGHT_SOCKET, TAB, -60, -300)
			: arc(FRONT_TAB, TAB, 225, 495),
		line(SIDE, SIDE - CORNER),
		arc(FRONT_CORNER, CORNER, 0, 90),
		...(leftSocket
			? [line(MID + NECK, SIDE), arc(LEFT_SOCKET, TAB, 30, -210)]
			: []),
		line(CORNER, SIDE),
		arc(LEFT_CORNER, CORNER, 90, 180),
		line(0, MID + NECK),
		arc(LEFT_TAB, TAB, 60, 300),
		line(0, CORNER),
		arc([CORNER, CORNER], CORNER, 180, 270),
	];
	const front = [
		{ end: circlePoint(LEFT_CORNER, CORNER, 135) },
		arc(LEFT_CORNER, CORNER, 135, 90),
		...(leftSocket
			? [line(MID - NECK, SIDE), arc(LEFT_SOCKET, TAB, 150, 390)]
			: []),
		line(SIDE - CORNER, SIDE),
		arc(FRONT_CORNER, CORNER, 90, 0),
		line(SIDE, MID + (rightSocket ? NECK : FRONT_NECK)),
		...(rightSocket
			? [
					arc(RIGHT_SOCKET, TAB, 60, 300),
					line(SIDE, CORNER),
					arc(RIGHT_CORNER, CORNER, 0, -45),
				]
			: [arc(FRONT_TAB, TAB, 135, -45)]),
	];
	return { top: `${path(top)} Z`, wall: wall(front), edges: lowerEdges(front) };
}

const rightTip = circlePoint(RIGHT_CORNER, CORNER, -45);
const tabTip = circlePoint(FRONT_TAB, TAB, -45);
const rightWall = wall([
	{ end: tabTip },
	arc(FRONT_TAB, TAB, -45, -135),
	line(SIDE, CORNER),
	arc(RIGHT_CORNER, CORNER, 0, -45),
]);
const rightEdges = `${vertical(rightTip)} ${path(
	[
		{ end: rightTip },
		arc(RIGHT_CORNER, CORNER, -45, 0),
		{ end: [tabTip[0], SIDE - tabTip[0] / Math.sqrt(3)] },
	],
	DEPTH,
)}`;
const frontTabEdge = vertical(circlePoint(FRONT_TAB, TAB, 135));
const socketEdges = `${vertical(project(MID - NECK, SIDE))} ${vertical(project(MID + NECK, SIDE))}`;

function rearWall(left: boolean) {
	const tip = circlePoint(left ? LEFT_TAB : RIGHT_TAB, TAB, left ? 135 : -45);
	const edgeY = ((left ? -1 : 1) * tip[0]) / Math.sqrt(3);
	return {
		fill: `${path([
			{ end: tip },
			arc(left ? LEFT_TAB : RIGHT_TAB, TAB, left ? 135 : -45, left ? 60 : 30),
			{ end: [tip[0], edgeY] },
		])} Z`,
		edge: vertical(tip, edgeY - tip[1]),
	};
}

const leftRearWall = rearWall(true);
const rightRearWall = rearWall(false);
const EYE_SPACING = 24.3;
// The logo's eyes are 1:3 capsules, with one eye-height between their centers.
const EYE_RADIUS = EYE_SPACING / 6;
const EYE_HALF_STRAIGHT = EYE_RADIUS * 2;
// Center the pair on the face before applying the isometric projection.
const eyeStart: Point = [MID - EYE_SPACING / 2, MID - EYE_HALF_STRAIGHT];
const eyeEnd: Point = [MID - EYE_SPACING / 2, MID + EYE_HALF_STRAIGHT];
const eyeOffset = project(EYE_SPACING, 0);
const slot = `${path([
	{ end: circlePoint(eyeStart, EYE_RADIUS, 0) },
	arc(eyeStart, EYE_RADIUS, 0, -180),
	{ end: circlePoint(eyeEnd, EYE_RADIUS, 180) },
	arc(eyeEnd, EYE_RADIUS, 180, 0),
])} Z`;
const frontPiece = {
	name: "front",
	x: 117,
	y: SIDE,
	leftSocket: false,
	rightSocket: false,
};
const pieces = [
	{ name: "back", x: 117, y: 0, leftSocket: true, rightSocket: true },
	{
		name: "left",
		x: 117 - SIDE * COS_30,
		y: MID,
		leftSocket: false,
		rightSocket: true,
	},
	{
		name: "raised",
		x: 117 + SIDE * COS_30,
		y: MID - DEPTH,
		leftSocket: true,
		rightSocket: false,
	},
	frontPiece,
].map((piece) => ({
	...piece,
	...pieceGeometry(piece.leftSocket, piece.rightSocket),
}));

// Keep the motion inside the SVG so exported artwork remains interactive.
const puzzleMotionCss = `
[data-customization-illustration] [data-puzzle-piece="raised"] {
	transform: translateY(0);
	transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
}
@media (hover: hover) {
	[data-customization-illustration]:hover [data-puzzle-piece="raised"] {
		transform: translateY(${DEPTH}px);
	}
}
@media (prefers-reduced-motion: reduce) {
	[data-customization-illustration] [data-puzzle-piece="raised"] {
		transition: none;
	}
}
`;

/** Clean isometric contours retain the Figma artwork's theme-aware neutral colors. */
export function CustomizationEmptyIllustration({
	className,
}: {
	className?: string;
}) {
	return (
		<svg
			data-customization-illustration=""
			aria-hidden="true"
			focusable="false"
			className={className}
			width="234.035"
			height="155"
			viewBox="0 0 234.035 155"
			fill="var(--neutral-2)"
			stroke="var(--neutral-6)"
			strokeWidth="1"
			strokeLinejoin="round"
			strokeLinecap="round"
		>
			<style>{puzzleMotionCss}</style>
			{/* A fixed hover area keeps the pointer inside while the piece moves. */}
			<rect width="100%" height="100%" fill="transparent" stroke="none" />
			{pieces.map((piece) => (
				<Fragment key={piece.name}>
					{/* The descending piece covers the front tab's rear wall. */}
					{piece.name === "raised" && (
						<g
							transform={`translate(${number(frontPiece.x)} ${number(frontPiece.y)})`}
						>
							<path d={rightRearWall.fill} stroke="none" />
							<path d={rightRearWall.edge} fill="none" />
						</g>
					)}
					<g transform={`translate(${number(piece.x)} ${number(piece.y)})`}>
						<g data-puzzle-piece={piece.name}>
							<g stroke="none">
								{piece.name !== "front" && <path d={leftRearWall.fill} />}
								{piece.name !== "left" && piece.name !== "front" && (
									<path d={rightRearWall.fill} />
								)}
								{!piece.rightSocket && <path d={rightWall} />}
								<path d={piece.wall} />
							</g>
							<g fill="none">
								{!piece.rightSocket && (
									<path d={`${rightEdges} ${frontTabEdge}`} />
								)}
								<path d={piece.edges} />
								{piece.name !== "front" && <path d={leftRearWall.edge} />}
								{piece.name !== "left" && piece.name !== "front" && (
									<path d={rightRearWall.edge} />
								)}
								{piece.leftSocket && <path d={socketEdges} />}
							</g>
							<path
								d={piece.top}
								fill={
									piece.name === "raised"
										? "var(--neutral-3)"
										: "var(--neutral-2)"
								}
							/>
							{piece.name === "front" && (
								<g fill="var(--neutral-5)">
									<path d={slot} />
									<path
										d={slot}
										transform={`translate(${number(eyeOffset[0])} ${number(eyeOffset[1])})`}
									/>
								</g>
							)}
						</g>
					</g>
				</Fragment>
			))}
		</svg>
	);
}
