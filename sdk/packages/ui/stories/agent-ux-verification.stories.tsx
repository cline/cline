import type { Meta, StoryObj } from "@storybook/react-vite";
import type { UxVerificationReport } from "@cline/shared/browser";
import { AgentUxVerification } from "../components/agent-ux-verification";
const home = new URL("./assets/ux-verifier/home.jpg", import.meta.url).href;
const sidebar = new URL("./assets/ux-verifier/sidebar.jpg", import.meta.url)
	.href;

const report: UxVerificationReport = {
	kind: "ux_verification",
	version: 1,
	title: "UX verification · sample report",
	subtitle: "Captured app screenshots · sample results for UI review",
	checks: [
		{
			id: "home",
			title: "Home opens with the welcome screen",
			subtitle: "The welcome artwork and composer are visible together.",
			action: "Opened Chat",
			status: "passed",
			screenshot: {
				id: "home-frame",
				modality: "image",
				mediaType: "image/jpeg",
				source: { type: "url", url: home },
			},
		},
		{
			id: "sidebar",
			title: "The sidebar shows the Chat entry",
			subtitle: "Chat is available from the original navigation.",
			action: "Returned to Chat",
			status: "passed",
			screenshot: {
				id: "sidebar-frame",
				modality: "image",
				mediaType: "image/jpeg",
				source: { type: "url", url: sidebar },
			},
		},
	],
};
const meta: Meta<typeof AgentUxVerification> = {
	title: "Agent/UX verification",
	component: AgentUxVerification,
	tags: ["autodocs"],
	args: {
		output: report,
		state: "completed",
		renderScreenshot: (check, className, _presentation) => (
			<img
				alt={check.title}
				className={className}
				src={
					check.screenshot?.source.type === "url"
						? check.screenshot.source.url
						: undefined
				}
			/>
		),
	},
	render: (args) => (
		<div style={{ maxWidth: 900, margin: "32px auto", padding: 16 }}>
			<AgentUxVerification {...args} />
		</div>
	),
};
export default meta;
type Story = StoryObj<typeof AgentUxVerification>;
export const Evidence: Story = {};
export const Running: Story = { args: { output: undefined, state: "running" } };
export const Blocked: Story = {
	args: {
		output: {
			...report,
			checks: [
				{
					id: "browser",
					title: "Browser tools unavailable",
					subtitle: "Connect browser tools before retrying this checklist.",
					status: "blocked",
				},
			],
		},
	},
};
export const Invalid: Story = { args: { output: {}, state: "completed" } };

/** Artifact access belongs to the host; this story illustrates the unresolved state. */
export const ArtifactReference: Story = {
	args: {
		renderScreenshot: undefined,
		output: {
			...report,
			checks: [
				{
					id: "cloud",
					title: "Menu opened",
					subtitle:
						"Screenshot retained by artifact ID for the host to resolve.",
					status: "passed",
					screenshot: {
						id: "cloud-frame",
						modality: "image",
						mediaType: "image/png",
						source: { type: "artifact", artifactId: "captured-menu.png" },
					},
				},
			],
		},
	},
};
