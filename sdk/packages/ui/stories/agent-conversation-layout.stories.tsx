import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	AgentConversationHeader,
	AgentConversationLayout,
	AgentSessionContent,
} from "../components/agent-conversation-layout";
import { AgentWelcomeHero } from "../components/agent-welcome-hero";
import { Button } from "../components/button";
import { SessionStatus } from "../components/session-status";

const meta: Meta<typeof AgentConversationLayout> = {
	title: "Components/Conversation layout",
	component: AgentConversationLayout,
	tags: ["autodocs"],
	parameters: { layout: "fullscreen" },
	args: {
		welcome: true,
		welcomeHeader: (
			<>
				<h1 className="sr-only">What would you like to build?</h1>
				<AgentWelcomeHero />
				<p className="mt-11">Workspace controls</p>
			</>
		),
		body: (
			<AgentSessionContent className="p-6">
				<p>Host-owned transcript and scroll behavior.</p>
			</AgentSessionContent>
		),
		composer: (
			<textarea
				aria-label="Message"
				className="h-28 w-full rounded-lg border border-cline-ui-border bg-cline-ui-background p-4"
				placeholder="Host-owned composer"
			/>
		),
		welcomeFooter: (
			<p className="mt-3 text-center text-xs">
				Host-owned suggestions and environment details
			</p>
		),
	},
	decorators: [
		(Story) => (
			<div className="flex h-screen flex-col bg-cline-ui-background text-cline-ui-foreground">
				<AgentConversationHeader
					actions={
						<Button variant="ghost" size="sm">
							New session
						</Button>
					}
				>
					<SessionStatus tone="neutral" label="Idle" showLabel={false} />
					<span className="truncate text-sm">Session title</span>
				</AgentConversationHeader>
				<Story />
			</div>
		),
	],
};
export default meta;
type Story = StoryObj<typeof meta>;
export const Welcome: Story = {};
export const Conversation: Story = { args: { welcome: false } };
export const Setup: Story = {
	args: {
		hideWelcomeComposer: true,
		welcomeSetup: (
			<div className="mt-4 rounded-lg border border-cline-ui-border p-6">
				Host-owned setup surface
			</div>
		),
	},
};
