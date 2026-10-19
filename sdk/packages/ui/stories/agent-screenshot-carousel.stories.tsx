import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	type AgentScreenshot,
	AgentScreenshotCarousel,
} from "../components/agent-screenshot-carousel";

function frame(label: string, hue: number, width = 1280, height = 800) {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="hsl(${hue} 30% 96%)" />
  <rect width="100%" height="64" fill="hsl(${hue} 40% 99%)" />
  <rect x="24" y="96" width="${width - 48}" height="${height - 120}" rx="16" fill="hsl(${hue} 45% 88%)" />
  <text x="50%" y="55%" text-anchor="middle" fill="hsl(${hue} 40% 30%)" font-family="sans-serif" font-size="${width / 22}">${label}</text>
</svg>`;
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const screenshots: AgentScreenshot[] = [
	{
		id: "1",
		src: frame("Board", 220),
		title: "Board renders with the new shortcut hint",
		action: "launch",
		detail: "localhost:5173",
		status: "passed",
	},
	{
		id: "2",
		src: frame("Palette", 250),
		title: "Ctrl+K opens the command palette",
		action: "key",
		detail: "Ctrl+K",
		status: "passed",
	},
	{
		id: "3",
		src: frame("Search", 280),
		title: "Search narrows to “Show overdue”",
		action: "type",
		detail: "over",
		pointer: { x: 0.5, y: 0.29 },
		status: "passed",
	},
	{
		id: "4",
		src: frame("Mobile", 160, 390, 844),
		title: "Palette fits a 390px viewport",
		action: "resize",
		detail: "390×844",
		status: "passed",
	},
];

const meta: Meta<typeof AgentScreenshotCarousel> = {
	title: "Agent/Screenshot carousel",
	component: AgentScreenshotCarousel,
	tags: ["autodocs"],
	args: {
		screenshots,
		subtitle: "Chrome · captured by the agent in its cloud sandbox",
	},
};
export default meta;
type Story = StoryObj<typeof AgentScreenshotCarousel>;

export const Default: Story = {};
export const Compact: Story = {
	args: { compact: true },
	render: (args) => (
		<div style={{ maxWidth: 340 }}>
			<AgentScreenshotCarousel {...args} />
		</div>
	),
};
export const WithFailure: Story = {
	args: {
		autoPlay: false,
		screenshots: [
			...screenshots.slice(0, 2),
			{
				...screenshots[2],
				status: "failed",
				title: "Search shows no results for “over”",
			},
		],
	},
};
