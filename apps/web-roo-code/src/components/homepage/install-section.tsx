"use client"

import { VscVscode } from "react-icons/vsc"
import Link from "next/link"
import { motion } from "framer-motion"

interface InstallSectionProps {
	downloads: string | null
}

export function InstallSection({ downloads }: InstallSectionProps) {
	const backgroundVariants = {
		hidden: {
			opacity: 0,
		},
		visible: {
			opacity: 1,
			transition: {
				duration: 1.2,
				ease: "easeOut",
			},
		},
	}

	return (
		<section className="relative overflow-hidden border-t border-border py-16 sm:py-24 lg:py-32">
			<motion.div
				className="absolute inset-x-0 top-1/2 -translate-y-1/2"
				initial="hidden"
				whileInView="visible"
				viewport={{ once: true }}
				variants={backgroundVariants}>
				<div className="relative mx-auto max-w-[1200px]">
					<div className="absolute left-1/2 top-1/2 h-[500px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-[100%] bg-blue-500/10 blur-[120px]" />
				</div>
			</motion.div>
			<div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-3xl text-center">
					<h2 className="text-center text-xl font-semibold uppercase tracking-wider text-muted-foreground sm:text-2xl">
						Install Roo Code — Open & Flexible
					</h2>
					<p className="mt-4 text-center text-base text-muted-foreground sm:mt-6 sm:text-lg">
						Roo Code is open-source, model-agnostic, and developer-focused. Install from the VS Code
						Marketplace or the CLI in minutes, then bring your own AI model.
					</p>
					<div className="mt-10 flex flex-col items-center justify-center gap-6">
						<Link
							href="https://marketplace.visualstudio.com/items?itemName=RooVeterinaryInc.roo-cline"
							target="_blank"
							className="group relative inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border/50 bg-background/30 px-4 py-3 text-base backdrop-blur-xl transition-all duration-300 hover:border-border hover:bg-background/40 sm:w-auto sm:gap-3 sm:px-6 sm:py-4 sm:text-lg md:text-2xl">
							<div className="absolute -inset-px rounded-xl bg-gradient-to-r from-blue-500/30 via-cyan-500/30 to-purple-500/30 opacity-0 blur-sm transition-opacity duration-500 group-hover:opacity-100" />
							<div className="relative flex items-center gap-2 sm:gap-3">
								<VscVscode className="h-5 w-5 text-blue-400 sm:h-6 sm:w-6 md:h-8 md:w-8" />
								<span className="flex flex-wrap items-center gap-1 sm:gap-2 md:gap-3">
									<span className="text-foreground/90">VSCode Marketplace</span>
									{downloads !== null && (
										<>
											<span className="hidden font-black text-muted-foreground sm:inline">
												&middot;
											</span>
											<span className="text-muted-foreground">{downloads} Downloads</span>
										</>
									)}
								</span>
							</div>
						</Link>
						<div className="group relative w-full max-w-xl">
							<div className="absolute -inset-px rounded-xl bg-gradient-to-r from-blue-500/30 via-cyan-500/30 to-purple-500/30 opacity-0 blur-sm transition-opacity duration-500 group-hover:opacity-100" />
							<div className="relative overflow-hidden rounded-xl border border-border/50 bg-background/30 backdrop-blur-xl transition-all duration-500 ease-out group-hover:border-border group-hover:bg-background/40">
								<div className="border-b border-border/50 px-3 py-2 sm:px-4">
									<div className="text-sm text-muted-foreground">Install via CLI</div>
								</div>
								<div className="overflow-x-auto">
									<pre className="p-3 sm:p-4">
										<code className="whitespace-pre-wrap break-all text-sm text-foreground/90 sm:break-normal">
											code --install-extension RooVeterinaryInc.roo-cline
										</code>
									</pre>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</section>
	)
}
