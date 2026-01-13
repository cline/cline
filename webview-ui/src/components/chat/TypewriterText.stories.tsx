import type { Meta, StoryObj } from "@storybook/react-vite"
import { TypewriterText } from "./TypewriterText"

const meta: Meta<typeof TypewriterText> = {
	title: "Views/Components/TypewriterText",
	component: TypewriterText,
	parameters: {
		layout: "centered",
		docs: {
			description: {
				component: `
The TypewriterText component provides a typewriter animation effect that displays text character by character.

**Key Features:**
- **Streaming Animation**: Characters appear one at a time with configurable speed
- **Shimmer Effect**: After typing completes, text shows a subtle shimmer animation
- **Performance Optimized**: Uses React.memo to prevent unnecessary re-renders
- **Configurable Speed**: Control typing speed via the speed prop (milliseconds per character)

**Use Cases:**
- AI response streaming visualization
- Loading states with dynamic text
- Enhanced user engagement during content generation
- Visual feedback for progressive content delivery

**Props:**
- \`text\`: The complete text to display with typewriter effect
- \`speed\`: Typing speed in milliseconds per character (default: 30ms)

**Try It Out:**
Use the controls below to test different text content and typing speeds interactively. The component will restart the animation whenever you change the text or speed.
				`,
			},
		},
	},
	argTypes: {
		text: {
			control: "text",
			description: "The text to display with typewriter effect",
			table: {
				type: { summary: "string" },
			},
		},
		speed: {
			control: { type: "range", min: 10, max: 200, step: 10 },
			description: "Speed in milliseconds per character (lower = faster)",
			table: {
				type: { summary: "number" },
				defaultValue: { summary: "30" },
			},
		},
	},
	decorators: [
		(Story) => (
			<div className="w-full max-w-2xl p-6 bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)]">
				<Story />
			</div>
		),
	],
}

export default meta
type Story = StoryObj<typeof TypewriterText>

export const Default: Story = {
	args: {
		text: "I'll help you create a responsive navigation component for your React application. Let me start by examining your current project structure and then create a modern, accessible navigation component with mobile-first design, keyboard navigation support, smooth animations, and dark/light theme support.",
		speed: 30,
	},
	parameters: {
		docs: {
			description: {
				story: `Interactive demo of the TypewriterText component. Use the controls panel below to:

- **Change the text**: Type any text to see the typewriter effect
- **Adjust speed**: Use the slider to control typing speed (10ms = fast, 200ms = slow)
- **Test different scenarios**: Try short messages, long paragraphs, code snippets, emojis, or special characters

The component automatically restarts the animation when you change either the text or speed. After typing completes, you'll see a subtle shimmer effect on the text.`,
			},
		},
	},
}
