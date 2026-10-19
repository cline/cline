import type { Meta, StoryObj } from "@storybook/react-vite"
import { CLOSE_THE_LOOP_VERIFICATION } from "@/stories/close-the-loop/data"
import { WorkVerificationCarousel } from "./WorkVerificationCarousel"

const meta: Meta<typeof WorkVerificationCarousel> = {
	title: "Chat/WorkVerificationCarousel",
	component: WorkVerificationCarousel,
	parameters: {
		layout: "padded",
		docs: {
			description: {
				component:
					'Slideshow of the screenshots a sandbox agent captured while verifying its own work ("close the loop"). Autoplays with a per-frame progress bar, pauses on hover or manual navigation, supports arrow keys, and expands to a lightbox.',
			},
		},
	},
	decorators: [
		(Story) => (
			<div className="w-[440px]">
				<Story />
			</div>
		),
	],
	args: {
		verification: CLOSE_THE_LOOP_VERIFICATION,
		autoPlay: true,
		intervalMs: 4000,
	},
}

export default meta
type Story = StoryObj<typeof WorkVerificationCarousel>

export const Autoplay: Story = {}

export const Paused: Story = {
	args: { autoPlay: false },
}

export const WithFailure: Story = {
	args: {
		verification: {
			...CLOSE_THE_LOOP_VERIFICATION,
			screenshots: CLOSE_THE_LOOP_VERIFICATION.screenshots.map((shot, index) =>
				index === 3
					? {
							...shot,
							outcome: "fail",
							title: "Heatmap overflows the viewport at 390px",
							note: "The grid does not scroll horizontally; the last 8 weeks are clipped.",
						}
					: shot,
			),
		},
		autoPlay: false,
	},
}

export const SingleScreenshot: Story = {
	args: {
		verification: {
			summary: "Verified in sandbox",
			target: "cli: habitat --help",
			durationMs: 6_000,
			screenshots: [CLOSE_THE_LOOP_VERIFICATION.screenshots[4]],
		},
	},
}
