"use client"

import type React from "react"
import { motion } from "framer-motion"

interface AnimatedTextProps {
	children: React.ReactNode
	className?: string
}

export function AnimatedText({ children, className }: AnimatedTextProps) {
	return (
		<motion.span
			className={className}
			initial={{ opacity: 0, y: 20 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{
				duration: 0.8,
				ease: [0.2, 0.65, 0.3, 0.9],
			}}>
			{children}
		</motion.span>
	)
}
