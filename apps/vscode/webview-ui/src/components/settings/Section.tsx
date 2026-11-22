import { HTMLAttributes } from "react"

type SectionProps = HTMLAttributes<HTMLDivElement>

const Section = ({ className, ...props }: SectionProps) => (
	<div className={`flex flex-col gap-5 ${className || ""}`} {...props} />
)

export default Section
