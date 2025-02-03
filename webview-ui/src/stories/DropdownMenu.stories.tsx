import type { Meta, StoryObj } from "@storybook/react"
import {
	HamburgerMenuIcon,
	BorderLeftIcon,
	BorderRightIcon,
	BorderBottomIcon,
	BorderTopIcon,
	TextAlignLeftIcon,
	TextAlignCenterIcon,
	TextAlignRightIcon,
} from "@radix-ui/react-icons"

import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuPortal,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@/components/ui"

const meta = {
	title: "@shadcn/DropdownMenu",
	component: DropdownMenu,
	parameters: { layout: "centered" },
	tags: ["autodocs"],
} satisfies Meta<typeof DropdownMenu>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
	name: "DropdownMenu",
	render: () => (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon">
					<HamburgerMenuIcon />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent>
				<DropdownMenuLabel>Label</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuItem>Item 1</DropdownMenuItem>
					<DropdownMenuItem>
						Item 2<DropdownMenuShortcut>⌘2</DropdownMenuShortcut>
					</DropdownMenuItem>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuSub>
						<DropdownMenuSubTrigger>Submenu</DropdownMenuSubTrigger>
						<DropdownMenuPortal>
							<DropdownMenuSubContent>
								<DropdownMenuItem>Foo</DropdownMenuItem>
								<DropdownMenuItem>
									Bar
									<DropdownMenuShortcut>⌘B</DropdownMenuShortcut>
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem>Baz</DropdownMenuItem>
							</DropdownMenuSubContent>
						</DropdownMenuPortal>
					</DropdownMenuSub>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	),
}

type DropdownMenuVariantProps = {
	side?: "top" | "bottom" | "left" | "right"
	align?: "start" | "center" | "end"
	children?: React.ReactNode
}

const DropdownMenuVariant = ({ side = "bottom", align = "center", children }: DropdownMenuVariantProps) => (
	<DropdownMenu>
		<DropdownMenuTrigger asChild>
			<Button variant="ghost" size="icon">
				{children}
			</Button>
		</DropdownMenuTrigger>
		<DropdownMenuContent side={side} align={align}>
			<DropdownMenuItem>Foo</DropdownMenuItem>
			<DropdownMenuItem>Bar</DropdownMenuItem>
			<DropdownMenuItem>Baz</DropdownMenuItem>
		</DropdownMenuContent>
	</DropdownMenu>
)

export const Placements: Story = {
	render: () => (
		<div className="flex gap-2">
			<DropdownMenuVariant side="top">
				<BorderTopIcon />
			</DropdownMenuVariant>
			<DropdownMenuVariant side="bottom">
				<BorderBottomIcon />
			</DropdownMenuVariant>
			<DropdownMenuVariant side="left">
				<BorderLeftIcon />
			</DropdownMenuVariant>
			<DropdownMenuVariant side="right">
				<BorderRightIcon />
			</DropdownMenuVariant>
		</div>
	),
}

export const Alignments: Story = {
	render: () => (
		<div className="flex gap-2">
			<DropdownMenuVariant align="center">
				<TextAlignCenterIcon />
			</DropdownMenuVariant>
			<DropdownMenuVariant align="end">
				<TextAlignRightIcon />
			</DropdownMenuVariant>
			<DropdownMenuVariant align="start">
				<TextAlignLeftIcon />
			</DropdownMenuVariant>
		</div>
	),
}
