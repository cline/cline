import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { AgentImageLightboxContent } from "../components/agent-image-lightbox";

const sampleAttachmentSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400">
  <rect width="640" height="400" fill="#243746" />
  <circle cx="320" cy="180" r="90" fill="#80cbc4" />
  <text x="320" y="330" text-anchor="middle" fill="white" font-family="sans-serif" font-size="28">Attachment preview</text>
</svg>`;
const sampleAttachmentSrc = `data:image/svg+xml,${encodeURIComponent(sampleAttachmentSvg)}`;
const meta: Meta<typeof AgentImageLightboxContent> = {
	title: "Agent/Image lightbox",
	component: AgentImageLightboxContent,
	tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof AgentImageLightboxContent>;

function Example({ narrow = false }: { narrow?: boolean }) {
	const [open, setOpen] = useState(true);
	return (
		<div
			className="relative mx-auto h-[420px]"
			style={{ maxWidth: narrow ? 320 : 800 }}
		>
			{open ? (
				<div
					role="dialog"
					aria-modal="true"
					aria-label="Expanded attachment"
					className="absolute inset-0 z-50 flex items-center justify-center bg-cline-ui-background/95 p-4 backdrop-blur-sm"
				>
					<AgentImageLightboxContent
						src={sampleAttachmentSrc}
						alt="Attachment preview"
						onClose={() => setOpen(false)}
					/>
				</div>
			) : (
				<button type="button" onClick={() => setOpen(true)}>
					Reopen attachment
				</button>
			)}
		</div>
	);
}

export const Default: Story = { render: () => <Example /> };
export const Narrow: Story = { render: () => <Example narrow /> };
