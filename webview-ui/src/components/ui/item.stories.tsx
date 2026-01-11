import type { Meta } from "@storybook/react-vite"
import { BellIcon, SettingsIcon, UserIcon } from "lucide-react"
import { Badge } from "./badge"
import { Button } from "./button"
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemFooter,
	ItemGroup,
	ItemHeader,
	ItemMedia,
	ItemSeparator,
	ItemTitle,
} from "./item"

const meta: Meta<typeof Item> = {
	title: "Ui/Item",
	component: Item,
	parameters: {
		docs: {
			description: {
				component:
					"A flexible item component for building lists with media, content, actions, and separators. Supports multiple variants (default, outline, select, muted) and sizes.",
			},
		},
	},
}

export default meta

export const Default = () => (
	<div className="w-screen flex justify-center items-center">
		<div className="flex flex-col gap-5 w-full max-w-md px-4">
			<ItemGroup>
				<Item variant="default">
					<ItemMedia variant="icon">
						<UserIcon />
					</ItemMedia>
					<ItemContent>
						<ItemTitle>User Profile</ItemTitle>
						<ItemDescription>View and edit your profile information</ItemDescription>
					</ItemContent>
					<ItemActions>
						<Button size="sm" variant="ghost">
							Edit
						</Button>
					</ItemActions>
				</Item>
				<ItemSeparator />
				<Item variant="default">
					<ItemMedia variant="icon">
						<SettingsIcon />
					</ItemMedia>
					<ItemContent>
						<ItemTitle>Settings</ItemTitle>
						<ItemDescription>Manage your account settings and preferences</ItemDescription>
					</ItemContent>
				</Item>
				<ItemSeparator />
				<Item variant="default">
					<ItemMedia variant="icon">
						<BellIcon />
					</ItemMedia>
					<ItemContent>
						<ItemTitle>Notifications</ItemTitle>
						<ItemDescription>Configure notification preferences</ItemDescription>
					</ItemContent>
					<ItemActions>
						<Badge type="round" variant="info">
							3
						</Badge>
					</ItemActions>
				</Item>
			</ItemGroup>

			<Item variant="outline">
				<ItemContent>
					<ItemHeader>
						<ItemTitle>Item with Header and Footer</ItemTitle>
						<Badge variant="default">New</Badge>
					</ItemHeader>
					<ItemDescription>This item has a header and footer layout</ItemDescription>
					<ItemFooter>
						<span className="text-xs text-muted-foreground">2 hours ago</span>
						<Button size="sm" variant="link">
							View More
						</Button>
					</ItemFooter>
				</ItemContent>
			</Item>

			<Item size="sm" variant="select">
				<ItemContent>
					<ItemTitle>Select Variant</ItemTitle>
					<ItemDescription>This item uses the select variant with small size</ItemDescription>
				</ItemContent>
			</Item>

			<Item variant="muted">
				<ItemContent>
					<ItemTitle>Muted Variant</ItemTitle>
					<ItemDescription>This item has a subtle muted background</ItemDescription>
				</ItemContent>
			</Item>
		</div>
	</div>
)
