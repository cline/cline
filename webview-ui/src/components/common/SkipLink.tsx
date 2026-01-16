import React, { useRef } from "react"

interface SkipLinkProps {
	readonly targetId: string
	readonly label?: string
}

export const SkipLink: React.FC<SkipLinkProps> = ({ targetId, label = "Skip to main content" }) => {
	const linkRef = useRef<HTMLAnchorElement>(null)

	const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
		e.preventDefault()
		const target = document.getElementById(targetId)
		if (target) {
			target.focus()
			target.scrollIntoView({ behavior: "smooth", block: "start" })
			linkRef.current?.blur()
		}
	}

	return (
		<a aria-label={label} className="skip-link" href={`#${targetId}`} onClick={handleClick} ref={linkRef}>
			{label}
		</a>
	)
}
