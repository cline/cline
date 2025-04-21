import type { Meta, StoryObj } from "@storybook/react"
import { useState } from "react"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@src/components/ui/collapsible"
import { Button } from "@src/components/ui/button"
import { ChevronsUpDown } from "lucide-react"

const meta: Meta<typeof Collapsible> = {
	title: "Primitives/Collapsible",
	component: Collapsible,
	tags: ["autodocs"],
}

export default meta

type Story = StoryObj<typeof Collapsible>

export const Default: Story = {
	render: () => <CollapsibleDemo />,
}

const CollapsibleDemo = () => {
	const [isOpen, setIsOpen] = useState(false)

	return (
		<Collapsible open={isOpen} onOpenChange={setIsOpen}>
			<CollapsibleTrigger asChild>
				<Button variant="ghost">
					Hello
					<ChevronsUpDown className="size-4" />
				</Button>
			</CollapsibleTrigger>
			<CollapsibleContent className="p-2">👋</CollapsibleContent>
		</Collapsible>
	)
}
