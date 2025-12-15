import { LucideProps } from "lucide-react"
import React from "react"
import { Alert } from "./alert"

const Banner = React.forwardRef<
	HTMLDivElement,
	React.HTMLAttributes<HTMLDivElement> & {
		isDismissible?: boolean
		title: string
		icon: React.ForwardRefExoticComponent<Omit<LucideProps, "ref"> & React.RefAttributes<SVGSVGElement>>
		description: string
	}
>(({ className, children, isDismissible = true, title, icon, description, ...props }, ref) => {
	return (
		<Alert
			className={className}
			description={description}
			icon={React.createElement(icon)}
			isDismissible={isDismissible}
			ref={ref}
			title={title}
			{...props}
		/>
	)
})
Banner.displayName = "Banner"

export { Banner }
