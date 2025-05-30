"use client"

import { motion } from "framer-motion"

export function CompanyLogos() {
	const logos = [
		{ name: "Company 1", logo: "/placeholder.svg?height=40&width=120" },
		{ name: "Company 2", logo: "/placeholder.svg?height=40&width=120" },
		{ name: "Company 3", logo: "/placeholder.svg?height=40&width=120" },
		{ name: "Company 4", logo: "/placeholder.svg?height=40&width=120" },
		{ name: "Company 5", logo: "/placeholder.svg?height=40&width=120" },
		{ name: "Company 6", logo: "/placeholder.svg?height=40&width=120" },
	]

	return (
		<div className="mt-10">
			<div className="mx-auto grid max-w-5xl grid-cols-2 gap-8 py-8 md:grid-cols-3 lg:grid-cols-6">
				{logos.map((company, index) => (
					<motion.div
						key={index}
						initial={{ opacity: 0, y: 20 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{
							duration: 0.5,
							delay: index * 0.1,
							ease: "easeOut",
						}}
						className="flex items-center justify-center">
						{/* eslint-disable @next/next/no-img-element */}
						<img
							src={company.logo || "/placeholder.svg"}
							alt={company.name}
							className="h-10 w-auto opacity-70 grayscale transition-all duration-300 hover:opacity-100 hover:grayscale-0"
						/>
					</motion.div>
				))}
			</div>
		</div>
	)
}
