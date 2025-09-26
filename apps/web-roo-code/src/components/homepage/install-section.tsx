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
		<section className="relative overflow-hidden border-t-2 border-border bg-gradient-to-b from-background via-background/95 to-background dark:from-background dark:via-background/98 dark:to-background py-20 sm:py-28 lg:py-36">
			{/* Enhanced background with better contrast */}
			<motion.div
				className="absolute inset-0"
				initial="hidden"
				whileInView="visible"
				viewport={{ once: true }}
				variants={backgroundVariants}>
				<div className="absolute inset-0 bg-gradient-to-b from-blue-500/5 via-cyan-500/5 to-purple-500/5 dark:from-blue-500/10 dark:via-cyan-500/10 dark:to-purple-500/10" />
				<div className="relative mx-auto max-w-[1200px]">
					<div className="absolute left-1/2 top-1/2 h-[600px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-[100%] bg-gradient-to-r from-blue-500/20 via-cyan-500/20 to-purple-500/20 blur-[100px] dark:from-blue-500/30 dark:via-cyan-500/30 dark:to-purple-500/30" />
				</div>
			</motion.div>

			<div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-4xl">
					{/* Enhanced container with better visual separation */}
					<div className="relative rounded-3xl border border-border/50 bg-background/60 p-8 shadow-2xl backdrop-blur-xl dark:border-border/30 dark:bg-background/40 dark:shadow-[0_20px_50px_rgba(0,0,0,0.5)] sm:p-12 lg:p-16">
						{/* Subtle gradient overlay */}
						<div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-blue-500/5 via-transparent to-purple-500/5 dark:from-blue-500/10 dark:to-purple-500/10" />

						<div className="relative text-center">
							{/* Updated h2 to match other sections */}
							<h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-5xl">
								Install Roo Code now
							</h2>
							<p className="mt-6 text-lg text-muted-foreground">
								Install from the VS Code Marketplace or the CLI in minutes, then bring your own AI
								model.
								<br />
								Roo Code is also compatible with all VSCode forks.
							</p>

							<div className="mt-12 flex flex-col items-center justify-center gap-6">
								{/* Enhanced VSCode Marketplace button */}
								<Link
									href="https://marketplace.visualstudio.com/items?itemName=RooVeterinaryInc.roo-cline"
									target="_blank"
									className="group relative inline-flex w-full items-center justify-center gap-3 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 px-6 py-4 text-lg font-medium text-white shadow-lg transition-all duration-300 hover:from-blue-700 hover:to-cyan-700 hover:shadow-xl hover:shadow-blue-500/25 dark:from-blue-500 dark:to-cyan-500 dark:hover:from-blue-600 dark:hover:to-cyan-600 sm:w-auto sm:px-8 sm:text-xl">
									<div className="absolute -inset-px rounded-xl bg-gradient-to-r from-blue-400 via-cyan-400 to-blue-400 opacity-0 blur transition-opacity duration-500 group-hover:opacity-70" />
									<div className="relative flex flex-col md:flex-row items-center md:gap-3">
										<VscVscode className="h-6 w-6 shrink-0" />
										<span className="flex flex-col md:flex-row items-center md:gap-2">
											<span>From VS Code Marketplace</span>
											{downloads !== null && (
												<>
													<span className="font-black opacity-60 hidden md:inline">
														&middot;
													</span>
													<span className="opacity-90">{downloads} Downloads</span>
												</>
											)}
										</span>
									</div>
								</Link>

								{/* Enhanced CLI install section */}
								<div className="group relative w-full max-w-xl">
									<div className="absolute -inset-px rounded-xl bg-gradient-to-r from-blue-500/50 via-cyan-500/50 to-purple-500/50 opacity-30 blur-sm transition-all duration-500 group-hover:opacity-60 dark:opacity-40 dark:group-hover:opacity-70" />
									<div className="relative overflow-hidden rounded-xl border border-border bg-background/80 shadow-lg backdrop-blur-xl transition-all duration-500 ease-out group-hover:border-blue-500/50 group-hover:shadow-xl group-hover:shadow-blue-500/10 dark:border-border/50 dark:bg-background/60 dark:group-hover:border-blue-400/50">
										<div className="border-b border-border/50 bg-muted/30 px-4 py-3 dark:bg-muted/20">
											<div className="text-sm font-medium text-foreground">or via CLI</div>
										</div>
										<div className="overflow-x-auto bg-background/50 dark:bg-background/30">
											<pre className="p-4">
												<code className="whitespace-pre-wrap break-all text-sm font-mono text-foreground sm:break-normal sm:text-base">
													code --install-extension RooVeterinaryInc.roo-cline
												</code>
											</pre>
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</section>
	)
}
