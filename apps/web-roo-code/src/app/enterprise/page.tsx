import { Code, CheckCircle, Shield, Users, Zap, Workflow } from "lucide-react"

import { Button } from "@/components/ui"
import { AnimatedText } from "@/components/animated-text"
import { AnimatedBackground } from "@/components/homepage"
import { ContactForm } from "@/components/enterprise/contact-form"

export default async function Enterprise() {
	return (
		<>
			{/* Hero Section */}
			<section className="relative flex h-[calc(100vh-theme(spacing.16))] items-center overflow-hidden">
				<AnimatedBackground />
				<div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
					<div className="grid gap-8 md:gap-12 lg:grid-cols-2 lg:gap-16">
						<div className="flex flex-col justify-center space-y-6 sm:space-y-8">
							<div>
								<h1 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl lg:text-6xl">
									<span className="block">Roo Code for</span>
									<AnimatedText className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
										Enterprise
									</AnimatedText>
								</h1>
								<p className="mt-4 max-w-md text-base text-muted-foreground sm:mt-6 sm:text-lg">
									A next-generation, AI-powered{" "}
									<AnimatedText className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
										coding partner
									</AnimatedText>{" "}
									for enterprise development teams.
								</p>
							</div>
							<div className="flex flex-col space-y-3 sm:flex-row sm:space-x-4 sm:space-y-0">
								<Button
									size="lg"
									className="w-full hover:bg-gray-200 dark:bg-white dark:text-black sm:w-auto"
									asChild>
									<a href="#contact" className="flex w-full items-center justify-center">
										Request a Demo
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
									<a href="#benefits" className="flex w-full items-center justify-center">
										Learn More
									</a>
								</Button>
							</div>
						</div>
						<div className="relative mt-8 flex items-center justify-center lg:mt-0">
							<div className="absolute inset-0 flex items-center justify-center">
								<div className="h-[250px] w-[250px] rounded-full bg-blue-500/20 blur-[100px] sm:h-[300px] sm:w-[300px] md:h-[350px] md:w-[350px]" />
							</div>
							<div className="relative z-10 rounded-lg border border-border bg-card p-6 shadow-lg">
								<div className="mb-4 flex items-center space-x-2">
									<Code className="h-6 w-6 text-blue-400" />
									<h3 className="text-lg font-semibold">Roo Code Enterprise</h3>
								</div>
								<p className="mb-4 text-sm text-muted-foreground">
									An AI extension of your team that handles coding tasks, from new code generation to
									refactoring, bug fixing, and documentation.
								</p>
								<div className="space-y-2">
									<div className="flex items-center space-x-2">
										<CheckCircle className="h-4 w-4 text-green-400" />
										<span className="text-sm">Accelerate development cycles</span>
									</div>
									<div className="flex items-center space-x-2">
										<CheckCircle className="h-4 w-4 text-green-400" />
										<span className="text-sm">Enterprise-grade security</span>
									</div>
									<div className="flex items-center space-x-2">
										<CheckCircle className="h-4 w-4 text-green-400" />
										<span className="text-sm">Custom-tailored to your workflow</span>
									</div>
									<div className="flex items-center space-x-2">
										<CheckCircle className="h-4 w-4 text-green-400" />
										<span className="text-sm">Improve collaboration and onboarding</span>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* Key Messaging Sections */}
			<section id="benefits" className="bg-secondary/50 py-16">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mb-12 text-center">
						<h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Empower Your Development Team</h2>
						<p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
							Roo Code functions like an entire AI dev team embedded in your developers&apos; IDE, ready
							to accelerate software delivery and improve code quality.
						</p>
					</div>

					<div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
						{/* Card 1 */}
						<div className="rounded-lg border border-border bg-card p-6 shadow-sm transition-all hover:shadow-md">
							<div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/20">
								<Zap className="h-6 w-6 text-blue-500" />
							</div>
							<h3 className="mb-2 text-xl font-bold">Accelerate Development Cycles</h3>
							<p className="text-muted-foreground">
								Supercharge development with AI assistance that helps developers code faster while
								maintaining quality.
							</p>
							<ul className="mt-4 space-y-2">
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>Faster time-to-market</span>
								</li>
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>AI pair-programming</span>
								</li>
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>Improved code quality</span>
								</li>
							</ul>
						</div>

						{/* Card 2 */}
						<div className="rounded-lg border border-border bg-card p-6 shadow-sm transition-all hover:shadow-md">
							<div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/20">
								<Users className="h-6 w-6 text-blue-500" />
							</div>
							<h3 className="mb-2 text-xl font-bold">Augment Your Team with AI Agents</h3>
							<p className="text-muted-foreground">
								Roo Code functions like an AI extension of your team, handling various coding tasks.
							</p>
							<ul className="mt-4 space-y-2">
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>New code generation</span>
								</li>
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>Refactoring and bug fixing</span>
								</li>
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>Automate complex migrations</span>
								</li>
							</ul>
						</div>

						{/* Card 3 */}
						<div className="rounded-lg border border-border bg-card p-6 shadow-sm transition-all hover:shadow-md">
							<div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/20">
								<Shield className="h-6 w-6 text-blue-500" />
							</div>
							<h3 className="mb-2 text-xl font-bold">Enterprise-Grade Security</h3>
							<p className="text-muted-foreground">
								Keep your data private with on-premises models, keeping proprietary code in-house.
							</p>
							<ul className="mt-4 space-y-2">
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>Security and compliance</span>
								</li>
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>No external cloud dependencies</span>
								</li>
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>Open-source and extensible</span>
								</li>
							</ul>
						</div>

						{/* Card 4 */}
						<div className="rounded-lg border border-border bg-card p-6 shadow-sm transition-all hover:shadow-md">
							<div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/20">
								<Workflow className="h-6 w-6 text-blue-500" />
							</div>
							<h3 className="mb-2 text-xl font-bold">Custom-Tailored to Your Workflow</h3>
							<p className="text-muted-foreground">
								Developers can create Custom Modes for specialized tasks like security auditing or
								performance tuning.
							</p>
							<ul className="mt-4 space-y-2">
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>Integrate with internal tools</span>
								</li>
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>Adapt to existing workflows</span>
								</li>
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>Custom AI behaviors</span>
								</li>
							</ul>
						</div>

						{/* Card 5 */}
						<div className="rounded-lg border border-border bg-card p-6 shadow-sm transition-all hover:shadow-md">
							<div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/20">
								<Users className="h-6 w-6 text-blue-500" />
							</div>
							<h3 className="mb-2 text-xl font-bold">Collaboration and Onboarding</h3>
							<p className="text-muted-foreground">
								Ask Mode enables developers to query their codebase in plain language and receive
								instant answers.
							</p>
							<ul className="mt-4 space-y-2">
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>Accelerates onboarding</span>
								</li>
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>Improves cross-team collaboration</span>
								</li>
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>Makes code more accessible</span>
								</li>
							</ul>
						</div>

						{/* Card 6 */}
						<div className="rounded-lg border border-border bg-card p-6 shadow-sm transition-all hover:shadow-md">
							<div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/20">
								<Zap className="h-6 w-6 text-blue-500" />
							</div>
							<h3 className="mb-2 text-xl font-bold">Faster Delivery, Lower Costs</h3>
							<p className="text-muted-foreground">
								Automate routine tasks to accelerate software releases and reduce costs.
							</p>
							<ul className="mt-4 space-y-2">
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>Improved code quality & consistency</span>
								</li>
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>Empowered developers, happier teams</span>
								</li>
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>Rapid knowledge sharing</span>
								</li>
							</ul>
						</div>
					</div>
				</div>
			</section>

			{/* Differentiator Section */}
			<section className="py-16">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mb-12 text-center">
						<h2 className="text-3xl font-bold tracking-tight sm:text-4xl">What Makes Roo Code Unique</h2>
						<p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
							Unlike traditional code editors or basic autocomplete tools, Roo Code is an autonomous
							coding agent with powerful capabilities.
						</p>
					</div>

					<div className="grid gap-8 md:grid-cols-2">
						<div className="rounded-lg border border-border bg-card p-8 shadow-sm">
							<h3 className="mb-4 text-2xl font-bold">Traditional AI Coding Assistants</h3>
							<ul className="space-y-3">
								<li className="flex items-start">
									<svg
										className="mr-2 mt-0.5 h-5 w-5 text-red-500"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor">
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M6 18L18 6M6 6l12 12"
										/>
									</svg>
									<span>Limited to autocomplete and simple suggestions</span>
								</li>
								<li className="flex items-start">
									<svg
										className="mr-2 mt-0.5 h-5 w-5 text-red-500"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor">
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M6 18L18 6M6 6l12 12"
										/>
									</svg>
									<span>Lack project-wide context understanding</span>
								</li>
								<li className="flex items-start">
									<svg
										className="mr-2 mt-0.5 h-5 w-5 text-red-500"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor">
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M6 18L18 6M6 6l12 12"
										/>
									</svg>
									<span>Can&apos;t execute commands or perform web actions</span>
								</li>
								<li className="flex items-start">
									<svg
										className="mr-2 mt-0.5 h-5 w-5 text-red-500"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor">
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M6 18L18 6M6 6l12 12"
										/>
									</svg>
									<span>No customization for enterprise workflows</span>
								</li>
								<li className="flex items-start">
									<svg
										className="mr-2 mt-0.5 h-5 w-5 text-red-500"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor">
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M6 18L18 6M6 6l12 12"
										/>
									</svg>
									<span>Often require sending code to external cloud services</span>
								</li>
							</ul>
						</div>

						<div className="rounded-lg border border-border bg-card p-8 shadow-sm">
							<h3 className="mb-4 text-2xl font-bold text-blue-400">Roo Code Enterprise</h3>
							<ul className="space-y-3">
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 text-green-500" />
									<span>Full-featured AI dev team with natural language communication</span>
								</li>
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 text-green-500" />
									<span>Deep understanding of your entire codebase</span>
								</li>
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 text-green-500" />
									<span>Can run tests, execute commands, and perform web actions</span>
								</li>
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 text-green-500" />
									<span>Custom modes for specialized enterprise tasks</span>
								</li>
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 text-green-500" />
									<span>On-premises deployment option for data privacy</span>
								</li>
							</ul>
						</div>
					</div>
				</div>
			</section>

			{/* CTA Section */}
			<section id="contact" className="bg-secondary/50 py-16">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-3xl text-center">
						<h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">
							Ready to Transform Your Development Process?
						</h2>
						<p className="mb-8 text-lg text-muted-foreground">
							Join our early access program and be among the first to experience the power of Roo Code for
							Enterprise.
						</p>
						<div className="grid gap-4 sm:grid-cols-2 sm:gap-6">
							<div className="rounded-lg border border-border bg-card p-6 text-center shadow-sm">
								<h3 className="mb-2 text-xl font-bold">Become an Early Access Partner</h3>
								<p className="mb-4 text-muted-foreground">
									Collaborate in shaping Roo Code&apos;s enterprise solution.
								</p>
								<ContactForm formType="early-access" buttonText="Apply Now" buttonClassName="w-full" />
							</div>
							<div className="rounded-lg border border-border bg-card p-6 text-center shadow-sm">
								<h3 className="mb-2 text-xl font-bold">Request a Demo</h3>
								<p className="mb-4 text-muted-foreground">
									See Roo Code&apos;s enterprise capabilities in action.
								</p>
								<ContactForm formType="demo" buttonText="Contact Us" buttonClassName="w-full" />
							</div>
						</div>
						<div className="mt-8">
							<Button variant="outline" size="lg">
								<a
									href="mailto:enterprise@roocode.com?subject=Enterprise Guide Request"
									className="flex items-center justify-center">
									Download the Enterprise Guide
								</a>
							</Button>
						</div>
					</div>
				</div>
			</section>
		</>
	)
}
