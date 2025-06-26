import { HTMLAttributes } from "react"

type SectionProps = HTMLAttributes<HTMLDivElement>

export const Section = ({ className, ...props }: SectionProps) => (
	<div className={`flex flex-col gap-3 p-5 py-2 ${className || ""}`} {...props} />
)

export default Section
