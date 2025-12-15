import type { Meta, StoryObj } from "@storybook/react-vite"
import ClineLogoWhite from "@/assets/ClineLogoWhite"
import { Button } from "./button"
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "./dialog"

const meta: Meta = {
	title: "Ui/Dialog",
	component: Dialog,
	parameters: {
		docs: {
			description: {
				component:
					"A modal dialog component built on Radix UI. Displays content in a layer above the main application with an overlay backdrop. Includes header, footer, title, description, and close button components for composing dialog layouts.",
			},
		},
	},
}

export default meta

type StoryProps = {
	dialogTitle: string
	dialogDescription: string
	dialogContent: string
	showFooter: boolean
	hideClose: boolean
	cancelText: string
	confirmText: string
	triggerVariant: "default" | "secondary" | "danger" | "outline" | "ghost" | "link"
	confirmVariant: "default" | "secondary" | "danger" | "outline" | "ghost"
}

// Interactive story with controls
export const Interactive: StoryObj<StoryProps> = {
	args: {
		dialogTitle: "Dialog Title",
		dialogDescription: "This is a description of what this dialog is about.",
		dialogContent: "This is the main content area of the dialog.",
		showFooter: true,
		hideClose: false,
		cancelText: "Cancel",
		confirmText: "Confirm",
		triggerVariant: "default",
		confirmVariant: "default",
	},
	argTypes: {
		dialogTitle: {
			control: "text",
			description: "Dialog title text",
		},
		dialogDescription: {
			control: "text",
			description: "Dialog description text",
		},
		dialogContent: {
			control: "text",
			description: "Main content of the dialog",
		},
		showFooter: {
			control: "boolean",
			description: "Show or hide the footer with action buttons",
		},
		cancelText: {
			control: "text",
			description: "Cancel button text",
		},
		confirmText: {
			control: "text",
			description: "Confirm button text",
		},
		triggerVariant: {
			control: "select",
			options: ["default", "secondary", "danger", "outline", "ghost", "link"],
			description: "Trigger button variant",
		},
		confirmVariant: {
			control: "select",
			options: ["default", "secondary", "danger", "outline", "ghost"],
			description: "Confirm button variant",
		},
		hideClose: {
			control: "boolean",
			description: "Hide or show the close button in the dialog",
		},
	},
	render: (args) => (
		<div className="w-full h-full flex justify-center items-center overflow-hidden">
			<div className="flex flex-col justify-center items-center h-[60%] w-[50%] overflow-hidden mt-50">
				<div className="flex justify-center my-5">
					<ClineLogoWhite className="size-16" />
				</div>
				<p>
					You can customize the dialog using the controls in the "Controls" panel below to change its title,
					description, content, and button variants.
				</p>

				<div className="mt-4.5">
					<Dialog>
						<DialogTrigger asChild>
							<Button variant={args.triggerVariant}>Open Dialog</Button>
						</DialogTrigger>
						<DialogContent hideClose={args.hideClose}>
							<DialogHeader>
								<DialogTitle>{args.dialogTitle}</DialogTitle>
								<DialogDescription>{args.dialogDescription}</DialogDescription>
							</DialogHeader>
							<p className="text-sm">{args.dialogContent}</p>
							{args.showFooter && (
								<DialogFooter>
									<DialogClose asChild>
										<Button variant="ghost">{args.cancelText}</Button>
									</DialogClose>
									<Button variant={args.confirmVariant}>{args.confirmText}</Button>
								</DialogFooter>
							)}
						</DialogContent>
					</Dialog>
				</div>
			</div>
		</div>
	),
}

// Showcase all dialog variants
export const Overview = () => {
	const variants = [
		{
			label: "Complete",
			triggerVariant: "default" as const,
			title: "Dialog Title",
			description:
				"This is a description of what this dialog is about. It provides context to the user about the action they're taking.",
			content:
				"This is the main content area of the dialog. You can put any content here, such as forms, information, or other interactive elements.",
			hasFooter: true,
			cancelVariant: "ghost" as const,
			confirmVariant: "default" as const,
			confirmText: "Confirm",
		},
		{
			label: "Simple",
			triggerVariant: "secondary" as const,
			title: "Simple Dialog",
			description: "This dialog has no footer, just content.",
			content: "This is a simpler dialog without action buttons in the footer.",
			hasFooter: false,
		},
		{
			label: "Confirmation",
			triggerVariant: "danger" as const,
			title: "Are you sure?",
			description: "This action cannot be undone. This will permanently delete the item.",
			content: null,
			hasFooter: true,
			cancelVariant: "secondary" as const,
			confirmVariant: "danger" as const,
			confirmText: "Delete",
		},
		{
			label: "With Form",
			triggerVariant: "outline" as const,
			title: "Edit Profile",
			description: "Make changes to your profile here.",
			content: (
				<div className="grid gap-4 py-4">
					<div className="grid gap-2">
						<label className="text-sm font-medium" htmlFor="name">
							Name
						</label>
						<input
							className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							defaultValue="John Doe"
							id="name"
						/>
					</div>
					<div className="grid gap-2">
						<label className="text-sm font-medium" htmlFor="email">
							Email
						</label>
						<input
							className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							defaultValue="john@example.com"
							id="email"
							type="email"
						/>
					</div>
				</div>
			),
			hasFooter: true,
			cancelVariant: "secondary" as const,
			confirmVariant: "default" as const,
			confirmText: "Save Changes",
		},
	]

	return (
		<div className="w-screen">
			<div className="flex flex-col justify-center h-[60%] w-[80%] overflow-hidden gap-8 p-8">
				{variants.map((variant) => (
					<div className="flex flex-col gap-4 items-center" key={variant.label}>
						<h2 className="text-lg font-semibold">{variant.label}</h2>
						<Dialog>
							<DialogTrigger asChild>
								<Button variant={variant.triggerVariant}>Open {variant.label}</Button>
							</DialogTrigger>
							<DialogContent>
								<DialogHeader>
									<DialogTitle>{variant.title}</DialogTitle>
									<DialogDescription>{variant.description}</DialogDescription>
								</DialogHeader>
								{typeof variant.content === "string" ? (
									<p className="text-sm">{variant.content}</p>
								) : (
									variant.content
								)}
								{variant.hasFooter && (
									<DialogFooter>
										<DialogClose asChild>
											<Button variant={variant.cancelVariant}>Cancel</Button>
										</DialogClose>
										<Button variant={variant.confirmVariant}>{variant.confirmText}</Button>
									</DialogFooter>
								)}
							</DialogContent>
						</Dialog>
					</div>
				))}
			</div>
		</div>
	)
}
