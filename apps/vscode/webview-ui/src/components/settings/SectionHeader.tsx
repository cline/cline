import { cn } from "@heroui/theme"
import { HTMLAttributes } from "react"

type SectionHeaderProps = HTMLAttributes<HTMLDivElement> & {
	children: React.ReactNode
	description?: string
}

const SectionHeader = ({ description, children, className, ...props }: SectionHeaderProps) => {
	return (
		<div className={cn("pb-4 mb-5 border-b border-white/[0.07]", className)} {...props}>
			<h2 className="m-0 text-[16.5px] font-semibold tracking-[-0.015em] text-[#f2f4f7]">{children}</h2>
			{description && <p className="text-[#858b94] text-[12.5px] mt-1.5 mb-0 leading-relaxed">{description}</p>}
		</div>
	)
}

export default SectionHeader
