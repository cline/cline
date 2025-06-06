import { HTMLAttributes } from "react"
import { cn } from "@/utils/cn"

type SectionProps = HTMLAttributes<HTMLDivElement>

export const Section = ({ className, ...props }: SectionProps) => (
	<div className={cn("flex flex-col gap-3 p-5 py-2", className)} {...props} />
)

export default Section
