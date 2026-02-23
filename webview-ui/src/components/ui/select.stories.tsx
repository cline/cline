import type { Meta, StoryObj } from "@storybook/react-vite"
import ClineLogoWhite from "@/assets/ClineLogoWhite"
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
} from "./select"

const meta: Meta = {
	title: "Ui/Select",
	component: Select,
	parameters: {
		docs: {
			description: {
				component:
					"A select dropdown component built on Radix UI. Allows users to choose from a list of options with support for grouping, separators, labels, and custom styling. Includes trigger, content, item, and value components for composing select layouts.",
			},
		},
	},
}

export default meta

type StoryProps = {
	placeholder: string
	size: "sm" | "default"
	items: string[]
	defaultValue?: string
	disabled: boolean
	showGroups: boolean
	showSeparators: boolean
}

// Interactive story with controls
export const Interactive: StoryObj<StoryProps> = {
	args: {
		placeholder: "Select an option",
		size: "default",
		items: ["Option 1", "Option 2", "Option 3", "Option 4"],
		defaultValue: undefined,
		disabled: false,
		showGroups: false,
		showSeparators: false,
	},
	argTypes: {
		placeholder: {
			control: "text",
			description: "Placeholder text shown when no option is selected",
		},
		size: {
			control: "select",
			options: ["sm", "default"],
			description: "Size variant of the select trigger",
		},
		items: {
			control: "object",
			description: "Array of items to display in the select",
		},
		defaultValue: {
			control: "text",
			description: "Default selected value",
		},
		disabled: {
			control: "boolean",
			description: "Disable the select component",
		},
		showGroups: {
			control: "boolean",
			description: "Show items organized in groups with labels",
		},
		showSeparators: {
			control: "boolean",
			description: "Show separators between items",
		},
	},
	render: (args) => (
		<div className="w-full h-full flex justify-center items-center overflow-hidden">
			<div className="flex flex-col justify-center items-center h-[60%] w-[50%] overflow-hidden mt-50">
				<div className="flex justify-center my-5">
					<ClineLogoWhite className="size-16" />
				</div>
				<p>
					You can customize the select using the controls in the "Controls" panel below to change its placeholder, size,
					items, and styling options.
				</p>

				<div className="mt-4.5">
					<Select defaultValue={args.defaultValue} disabled={args.disabled}>
						<SelectTrigger size={args.size}>
							<SelectValue placeholder={args.placeholder} />
						</SelectTrigger>
						<SelectContent position="popper">
							{args.showGroups ? (
								<>
									<SelectGroup>
										<SelectLabel>Group 1</SelectLabel>
										{args.items.slice(0, Math.ceil(args.items.length / 2)).map((item) => (
											<SelectItem key={item} value={item}>
												{item}
											</SelectItem>
										))}
									</SelectGroup>
									{args.showSeparators && <SelectSeparator />}
									<SelectGroup>
										<SelectLabel>Group 2</SelectLabel>
										{args.items.slice(Math.ceil(args.items.length / 2)).map((item) => (
											<SelectItem key={item} value={item}>
												{item}
											</SelectItem>
										))}
									</SelectGroup>
								</>
							) : (
								args.items.map((item, index) => (
									<>
										<SelectItem key={item} value={item}>
											{item}
										</SelectItem>
										{args.showSeparators && index < args.items.length - 1 && <SelectSeparator />}
									</>
								))
							)}
						</SelectContent>
					</Select>
				</div>
			</div>
		</div>
	),
}

// Showcase all select variants
export const Overview = () => {
	const variants = [
		{
			label: "Basic",
			size: "default" as const,
			placeholder: "Select a fruit",
			items: ["Apple", "Banana", "Cherry", "Date", "Elderberry"],
			hasGroups: false,
			hasSeparators: false,
		},
		{
			label: "With Groups",
			size: "default" as const,
			placeholder: "Select a language",
			groups: [
				{
					label: "Frontend",
					items: ["JavaScript", "TypeScript", "HTML", "CSS"],
				},
				{
					label: "Backend",
					items: ["Python", "Java", "Go", "Rust"],
				},
			],
			hasGroups: true,
			hasSeparators: false,
		},
		{
			label: "With Separators",
			size: "default" as const,
			placeholder: "Select a tool",
			items: ["Git", "Docker", "Kubernetes", "Jenkins"],
			hasGroups: false,
			hasSeparators: true,
		},
	]

	return (
		<div className="w-screen">
			<div className="flex justify-center h-[60%] w-[80%] overflow-hidden gap-8 p-8">
				{variants.map((variant) => (
					<div className="flex flex-col gap-4" key={variant.label}>
						<h2 className="text-lg font-semibold">{variant.label}</h2>
						<Select>
							<SelectTrigger size={variant.size}>
								<SelectValue placeholder={variant.placeholder} />
							</SelectTrigger>
							<SelectContent position="popper">
								{variant.hasGroups && "groups" in variant ? (
									variant?.groups?.map((group, groupIndex) => (
										<>
											<SelectGroup key={group.label}>
												<SelectLabel>{group.label}</SelectLabel>
												{group.items.map((item) => (
													<SelectItem key={item} value={item}>
														{item}
													</SelectItem>
												))}
											</SelectGroup>
											{groupIndex < variant.groups.length - 1 && <SelectSeparator />}
										</>
									))
								) : (
									<>
										{"items" in variant &&
											variant?.items?.map((item, index) => (
												<>
													<SelectItem key={item} value={item}>
														{item}
													</SelectItem>
													{variant.hasSeparators && index < variant.items.length - 1 && (
														<SelectSeparator />
													)}
												</>
											))}
									</>
								)}
							</SelectContent>
						</Select>
					</div>
				))}
			</div>
		</div>
	)
}
