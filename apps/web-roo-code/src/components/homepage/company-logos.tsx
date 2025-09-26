"use client"

import { motion } from "framer-motion"
import Image from "next/image"

const logos = ["Apple", "Netflix", "Microsoft", "Amazon", "ByteDance", "Rakuten", "Carvana"]

export function CompanyLogos() {
	return (
		<div className="mt-14">
			<motion.p
				initial={{ opacity: 0, y: 10 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.5, ease: "easeOut" }}
				className="text-xs text-muted-foreground text-center mb-2 sm:text-left">
				Making devs more productive at
			</motion.p>
			<div className="mt-4 flex flex-wrap items-center gap-6 justify-center sm:justify-start">
				{logos.map((logo, index) => (
					<motion.div
						key={logo}
						initial={{ opacity: 0, y: 10 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.5, delay: index * 0.1, ease: "easeOut" }}>
						<Image
							width={0}
							height={0}
							className="h-[18px] w-auto overflow-clip opacity-70 dark:invert"
							src={`/logos/${logo.toLowerCase().replace(/\s+/g, "-")}.svg`}
							alt={`${logo} Logo`}
						/>
					</motion.div>
				))}
			</div>
		</div>
	)
}
