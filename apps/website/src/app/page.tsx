/* eslint-disable react/jsx-no-target-blank */

import { getVSCodeDownloads } from "@/lib/stats"

import { Button } from "@/components/ui"
import { AnimatedText } from "@/components/animated-text"
import {
	AnimatedBackground,
	InstallSection,
	Features,
	Testimonials,
	FAQSection,
	CodeExample,
} from "@/components/homepage"

// Invalidate cache when a request comes in, at most once every hour.
export const revalidate = 3600

export default async function Home() {
	const downloads = await getVSCodeDownloads()

	return (
		<>
			<section className="relative flex h-[calc(125vh-theme(spacing.16))] items-center overflow-hidden md:h-[calc(100svh-theme(spacing.16))] lg:h-[calc(100vh-theme(spacing.16))]">
				<AnimatedBackground />
				<div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
					<div className="grid gap-8 md:gap-12 lg:grid-cols-2 lg:gap-16">
						<div className="flex flex-col justify-center space-y-6 sm:space-y-8">
							<div>
								<h1 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl lg:text-6xl">
									<span className="block">Your</span>
									<AnimatedText className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
										AI-Powered
									</AnimatedText>
									<span className="block">Dev Team, Right in Your Editor.</span>
								</h1>
								<p className="mt-4 max-w-md text-base text-muted-foreground sm:mt-6 sm:text-lg">
									Supercharge your editor with AI that{" "}
									<AnimatedText className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
										understands your codebase
									</AnimatedText>
									, streamlines development, and helps you write, refactor, and debug with ease.
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
										Install Roo Code
										<svg
											xmlns="http://www.w3.org/2000/svg"
											className="ml-2 h-4 w-4"
											viewBox="0 0 20 20"
											fill="currentColor">
											<path
												fillRule="evenodd"
												d="M10.293 5.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L12.586 11H5a1 1 0 110-2h7.586l-2.293-2.293a1 1 0 010-1.414z"
												clipRule="evenodd"
											/>
										</svg>
									</a>
								</Button>
								<Button variant="outline" size="lg" className="w-full sm:w-auto">
									<a
										href="https://docs.roocode.com"
										target="_blank"
										className="flex w-full items-center justify-center">
										View Documentation
									</a>
								</Button>
							</div>
						</div>
						<div className="relative mt-8 flex items-center justify-center lg:mt-0">
							<div className="absolute inset-0 flex items-center justify-center">
								<div className="h-[250px] w-[250px] rounded-full bg-blue-500/20 blur-[100px] sm:h-[300px] sm:w-[300px] md:h-[350px] md:w-[350px]" />
							</div>
							<CodeExample />
						</div>
					</div>
				</div>
			</section>
			<div id="features">
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
