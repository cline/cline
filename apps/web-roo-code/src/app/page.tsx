/* eslint-disable react/jsx-no-target-blank */

import { getVSCodeDownloads } from "@/lib/stats"

import { Button } from "@/components/ui"
import {
	AnimatedBackground,
	InstallSection,
	Features,
	Testimonials,
	FAQSection,
	CodeExample,
} from "@/components/homepage"
import { EXTERNAL_LINKS } from "@/lib/constants"
import { ArrowRight } from "lucide-react"

// Invalidate cache when a request comes in, at most once every hour.
export const revalidate = 3600

export default async function Home() {
	const downloads = await getVSCodeDownloads()

	return (
		<>
			<section className="relative flex h-[calc(125vh-theme(spacing.12))] items-center overflow-hidden md:h-[calc(80svh-theme(spacing.12))]">
				<AnimatedBackground />
				<div className="container relative flex items-center h-full z-10 mx-auto px-4 sm:px-6 lg:px-8">
					<div className="grid h-full relative gap-8 md:gap-12 lg:grid-cols-2 lg:gap-16">
						<div className="flex flex-col px-4 justify-center space-y-6 sm:space-y-8">
							<div>
								<h1 className="text-3xl font-bold tracking-tight mt-8 sm:text-4xl md:text-5xl lg:text-6xl lg:mt-0">
									An entire AI-powered dev team. In your editor and beyond.
								</h1>
								<p className="mt-4 max-w-md text-base text-muted-foreground sm:mt-6 sm:text-lg">
									Roo&apos;s model-agnostic, specialized modes and fine-grained auto-approval controls
									give you the tools (and the confidence) to get AI working for you.
								</p>
							</div>
							<div className="flex flex-col space-y-3 sm:flex-row sm:space-x-4 sm:space-y-0">
								<Button
									size="lg"
									className="w-full hover:bg-gray-200 dark:bg-white dark:text-black sm:w-auto">
									<a
										href="https://marketplace.visualstudio.com/items?itemName=RooVeterinaryInc.roo-cline"
										target="_blank"
										className="flex w-full items-center justify-center">
										Install Extension
										<ArrowRight className="ml-2" />
									</a>
								</Button>
								<Button
									variant="outline"
									size="lg"
									className="w-full sm:w-auto bg-white/20 dark:bg-white/10 backdrop-blur-sm border border-black/40 dark:border-white/30 hover:border-blue-400 hover:bg-white/30 dark:hover:bg-white/20 hover:shadow-[0_0_20px_rgba(59,130,246,0.5)] transition-all duration-300">
									<a
										href={EXTERNAL_LINKS.CLOUD_APP_SIGNUP}
										target="_blank"
										className="flex w-full items-center justify-center">
										Get started with Cloud
										<ArrowRight className="ml-2" />
									</a>
								</Button>
							</div>
						</div>
						<div className="relative flex items-center mx-auto h-full mt-8 lg:mt-0">
							<div className="flex items-center justify-center">
								<CodeExample />
							</div>
						</div>
					</div>
				</div>
			</section>
			<div id="product">
				<Features />
			</div>
			<div id="testimonials">
				<Testimonials />
			</div>
			<div id="faq">
				<FAQSection />
			</div>
			<InstallSection downloads={downloads} />
		</>
	)
}
