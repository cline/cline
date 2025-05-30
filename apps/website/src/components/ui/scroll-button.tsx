"use client"

import { usePathname, useRouter } from "next/navigation"

interface ScrollButtonProps {
	targetId: string
	children: React.ReactNode
	className?: string
	onClick?: () => void
}

export function ScrollButton({ targetId, children, className = "", onClick }: ScrollButtonProps) {
	const router = useRouter()
	const pathname = usePathname()

	const handleClick = () => {
		if (pathname === "/") {
			// if we're on the home page, use smooth scrolling
			const section = document.getElementById(targetId)
			section?.scrollIntoView({ behavior: "smooth" })
		} else {
			// if we're on a different page, navigate directly to the section
			router.push(`/#${targetId}`)
		}
		onClick?.()
	}

	return (
		<button onClick={handleClick} className={className}>
			{children}
		</button>
	)
}
