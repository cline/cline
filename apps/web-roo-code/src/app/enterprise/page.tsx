import { Code, CheckCircle, Shield, Zap, Workflow, Lock, ArrowRight, DollarSign, Search, Network } from "lucide-react"

import { Button } from "@/components/ui"
import { AnimatedText } from "@/components/animated-text"
import { AnimatedBackground } from "@/components/homepage"
import { ContactForm } from "@/components/enterprise/contact-form"
import { EXTERNAL_LINKS } from "@/lib/constants"

export default async function Enterprise() {
	return (
		<>
			{/* Hero Section */}
			<section className="relative flex h-[calc(100vh-theme(spacing.12))] items-center overflow-hidden">
				<AnimatedBackground />
				<div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
					<div className="grid gap-8 md:gap-12 lg:grid-cols-2 lg:gap-16">
						<div className="flex flex-col justify-center space-y-6 sm:space-y-8">
							<div>
								<h1 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl lg:text-6xl">
									<span className="block">Roo Code Cloud for</span>
									<AnimatedText className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
										Enterprise
									</AnimatedText>
								</h1>
								<p className="mt-4 max-w-md text-base text-muted-foreground sm:mt-6 sm:text-lg">
									The{" "}
									<AnimatedText className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
										control-plane
									</AnimatedText>{" "}
									for AI-powered software development. Gain visibility, governance, and control over
									your AI coding initiatives.
								</p>
							</div>
							<div className="flex flex-col space-y-3 sm:flex-row sm:space-x-4 sm:space-y-0">
								<Button
									size="lg"
									className="w-full bg-black text-white hover:bg-gray-800 hover:shadow-lg hover:shadow-black/20 dark:bg-white dark:text-black dark:hover:bg-gray-200 dark:hover:shadow-white/20 transition-all duration-300 sm:w-auto"
									asChild>
									<a href="#contact" className="flex w-full items-center justify-center">
										Request a Demo
										<ArrowRight className="ml-2 h-4 w-4" />
									</a>
								</Button>
								<Button
									variant="outline"
									size="lg"
									className="w-full sm:w-auto bg-white/20 dark:bg-white/10 backdrop-blur-sm border border-black/40 dark:border-white/30 hover:border-blue-400 hover:bg-white/30 dark:hover:bg-white/20 hover:shadow-[0_0_20px_rgba(59,130,246,0.5)] transition-all duration-300">
									<a href="#benefits" className="flex w-full items-center justify-center">
										Why Roo Code
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
									<h3 className="text-lg font-semibold">Roo Code Cloud Control-Plane</h3>
								</div>
								<p className="mb-4 text-sm text-muted-foreground">
									A unified control system for managing Roo Code across your organization, with the
									flexibility to extend governance to your broader AI toolkit.
								</p>
								<div className="space-y-2">
									<div className="flex items-center space-x-2">
										<CheckCircle className="h-4 w-4 text-green-400" />
										<span className="text-sm">Centralized Roo Code management</span>
									</div>
									<div className="flex items-center space-x-2">
										<CheckCircle className="h-4 w-4 text-green-400" />
										<span className="text-sm">Real-time usage visibility</span>
									</div>
									<div className="flex items-center space-x-2">
										<CheckCircle className="h-4 w-4 text-green-400" />
										<span className="text-sm">Enterprise policy enforcement</span>
									</div>
									<div className="flex items-center space-x-2">
										<CheckCircle className="h-4 w-4 text-green-400" />
										<span className="text-sm">Extensible to other AI tools</span>
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
						<h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
							Take Control of Your AI Development
						</h2>
						<p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
							Roo Code Cloud provides enterprise-grade control and visibility for Roo Code deployments,
							with an extensible architecture for your evolving AI strategy.
						</p>
					</div>

					<div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
						{/* Card 1 */}
						<div className="rounded-lg border border-border bg-card p-6 shadow-sm transition-all hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/10 dark:hover:border-blue-400/50 dark:hover:shadow-blue-400/10">
							<div className="mb-5 inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-blue-500/10 to-cyan-500/10 p-2.5 dark:from-blue-500/20 dark:to-cyan-500/20">
								<div className="rounded-lg bg-gradient-to-r from-blue-500/80 to-cyan-500/80 p-2.5">
									<Network className="h-6 w-6 text-white" />
								</div>
							</div>
							<h3 className="mb-2 text-xl font-bold">Centralized AI Management Hub</h3>
							<p className="text-muted-foreground">
								Manage Roo Code deployments enterprise-wide, with an extensible platform ready for your
								broader AI ecosystem.
							</p>
							<ul className="mt-4 space-y-2">
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>Centralized token management</span>
								</li>
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>Multi-model support for Roo</span>
								</li>
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>Extensible architecture</span>
								</li>
							</ul>
						</div>

						{/* Card 2 */}
						<div className="rounded-lg border border-border bg-card p-6 shadow-sm transition-all hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/10 dark:hover:border-blue-400/50 dark:hover:shadow-blue-400/10">
							<div className="mb-5 inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-blue-500/10 to-cyan-500/10 p-2.5 dark:from-blue-500/20 dark:to-cyan-500/20">
								<div className="rounded-lg bg-gradient-to-r from-blue-500/80 to-cyan-500/80 p-2.5">
									<Search className="h-6 w-6 text-white" />
								</div>
							</div>
							<h3 className="mb-2 text-xl font-bold">Real-Time Usage Visibility</h3>
							<p className="text-muted-foreground">
								Track Roo Code usage across teams with detailed analytics and cost attribution.
							</p>
							<ul className="mt-4 space-y-2">
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>Token consumption tracking</span>
								</li>
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>Cost attribution by team</span>
								</li>
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>AI adoption insights</span>
								</li>
							</ul>
						</div>

						{/* Card 3 */}
						<div className="rounded-lg border border-border bg-card p-6 shadow-sm transition-all hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/10 dark:hover:border-blue-400/50 dark:hover:shadow-blue-400/10">
							<div className="mb-5 inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-blue-500/10 to-cyan-500/10 p-2.5 dark:from-blue-500/20 dark:to-cyan-500/20">
								<div className="rounded-lg bg-gradient-to-r from-blue-500/80 to-cyan-500/80 p-2.5">
									<Shield className="h-6 w-6 text-white" />
								</div>
							</div>
							<h3 className="mb-2 text-xl font-bold">Enterprise-Grade Governance</h3>
							<p className="text-muted-foreground">
								Implement security policies for Roo Code that align with your enterprise AI governance
								framework.
							</p>
							<ul className="mt-4 space-y-2">
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>Model allow-lists</span>
								</li>
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>Data residency controls</span>
								</li>
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>Audit trail compliance</span>
								</li>
							</ul>
						</div>

						{/* Card 4 */}
						<div className="rounded-lg border border-border bg-card p-6 shadow-sm transition-all hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/10 dark:hover:border-blue-400/50 dark:hover:shadow-blue-400/10">
							<div className="mb-5 inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-blue-500/10 to-cyan-500/10 p-2.5 dark:from-blue-500/20 dark:to-cyan-500/20">
								<div className="rounded-lg bg-gradient-to-r from-blue-500/80 to-cyan-500/80 p-2.5">
									<Workflow className="h-6 w-6 text-white" />
								</div>
							</div>
							<h3 className="mb-2 text-xl font-bold">5-Minute Control-Plane Setup</h3>
							<p className="text-muted-foreground">
								Deploy your Roo Code control-plane instantly with our SaaS solution. No infrastructure
								required.
							</p>
							<ul className="mt-4 space-y-2">
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>Instant deployment</span>
								</li>
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>SAML/SCIM integration</span>
								</li>
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>REST API access</span>
								</li>
							</ul>
						</div>

						{/* Card 5 */}
						<div className="rounded-lg border border-border bg-card p-6 shadow-sm transition-all hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/10 dark:hover:border-blue-400/50 dark:hover:shadow-blue-400/10">
							<div className="mb-5 inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-blue-500/10 to-cyan-500/10 p-2.5 dark:from-blue-500/20 dark:to-cyan-500/20">
								<div className="rounded-lg bg-gradient-to-r from-blue-500/80 to-cyan-500/80 p-2.5">
									<DollarSign className="h-6 w-6 text-white" />
								</div>
							</div>
							<h3 className="mb-2 text-xl font-bold">Manage AI Development Costs</h3>
							<p className="text-muted-foreground">
								Track and control Roo Code costs with detailed analytics and budget controls.
							</p>
							<ul className="mt-4 space-y-2">
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>Unified cost visibility</span>
								</li>
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>Department chargebacks</span>
								</li>
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>Usage optimization</span>
								</li>
							</ul>
						</div>

						{/* Card 6 */}
						<div className="rounded-lg border border-border bg-card p-6 shadow-sm transition-all hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/10 dark:hover:border-blue-400/50 dark:hover:shadow-blue-400/10">
							<div className="mb-5 inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-blue-500/10 to-cyan-500/10 p-2.5 dark:from-blue-500/20 dark:to-cyan-500/20">
								<div className="rounded-lg bg-gradient-to-r from-blue-500/80 to-cyan-500/80 p-2.5">
									<Zap className="h-6 w-6 text-white" />
								</div>
							</div>
							<h3 className="mb-2 text-xl font-bold">Zero Friction for Developers</h3>
							<p className="text-muted-foreground">
								Developers get seamless Roo Code access while you maintain governance and visibility.
							</p>
							<ul className="mt-4 space-y-2">
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>Automatic token refresh</span>
								</li>
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>Local sidecar architecture</span>
								</li>
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 shrink-0 text-green-500" />
									<span>No workflow disruption</span>
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
						<h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Why You Need a Control-Plane</h2>
						<p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
							See how Roo Code Cloud brings enterprise control to AI-powered development.
						</p>
					</div>

					<div className="grid gap-8 md:grid-cols-2">
						<div className="rounded-lg border border-border bg-card p-8 shadow-sm">
							<h3 className="mb-4 text-2xl font-bold">Current State: AI Tool Sprawl</h3>
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
									<span>Roo Code tokens managed individually by developers</span>
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
									<span>No visibility into AI tool usage or costs</span>
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
									<span>Inconsistent security practices</span>
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
									<span>Shadow AI spend on corporate cards</span>
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
									<span>No centralized governance framework</span>
								</li>
							</ul>
						</div>

						<div className="rounded-lg border border-border bg-card p-8 shadow-sm">
							<h3 className="mb-4 text-2xl font-bold text-blue-400">Roo Code Cloud Control-Plane</h3>
							<ul className="space-y-3">
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 text-green-500" />
									<span>Centralized Roo Code management dashboard</span>
								</li>
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 text-green-500" />
									<span>Complete visibility into usage and costs</span>
								</li>
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 text-green-500" />
									<span>Consistent policy enforcement</span>
								</li>
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 text-green-500" />
									<span>Controlled, trackable AI investments</span>
								</li>
								<li className="flex items-start">
									<CheckCircle className="mr-2 mt-0.5 h-5 w-5 text-green-500" />
									<span>Enterprise-ready governance platform</span>
								</li>
							</ul>
						</div>
					</div>
				</div>
			</section>

			{/* Security Hook Section */}
			<section className="py-16">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8">
					<div className="rounded-lg border border-border bg-card p-8 shadow-sm">
						<div className="grid gap-8 md:grid-cols-2 md:items-center">
							<div>
								<div className="mb-5 inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-blue-500/10 to-cyan-500/10 p-2.5 dark:from-blue-500/20 dark:to-cyan-500/20">
									<div className="rounded-lg bg-gradient-to-r from-blue-500/80 to-cyan-500/80 p-2.5">
										<Shield className="h-6 w-6 text-white" />
									</div>
								</div>
								<h3 className="mb-4 text-2xl font-bold">Enterprise-Grade Security</h3>
								<p className="mb-6 text-muted-foreground">
									Built with security-first principles to meet stringent enterprise requirements while
									maintaining developer productivity.
								</p>
								<ul className="space-y-3">
									<li className="flex items-center space-x-3">
										<CheckCircle className="h-5 w-5 text-green-500" />
										<span>SOC 2 Type I Certified with Type II in observation</span>
									</li>
									<li className="flex items-center space-x-3">
										<CheckCircle className="h-5 w-5 text-green-500" />
										<span>End-to-end encryption for all data transmission</span>
									</li>
									<li className="flex items-center space-x-3">
										<CheckCircle className="h-5 w-5 text-green-500" />
										<span>Security-first architecture with explicit permissions</span>
									</li>
									<li className="flex items-center space-x-3">
										<CheckCircle className="h-5 w-5 text-green-500" />
										<span>Complete audit trails and compliance reporting</span>
									</li>
									<li className="flex items-center space-x-3">
										<CheckCircle className="h-5 w-5 text-green-500" />
										<span>Open-source transparency for security verification</span>
									</li>
								</ul>
							</div>
							<div className="flex flex-col items-center justify-center">
								<div className="rounded-lg border border-border bg-secondary/50 p-6 text-center">
									<div className="mb-4 inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-blue-500/10 to-cyan-500/10 p-2.5 dark:from-blue-500/20 dark:to-cyan-500/20">
										<div className="rounded-lg bg-gradient-to-r from-blue-500/80 to-cyan-500/80 p-2.5">
											<Lock className="h-8 w-8 text-white" />
										</div>
									</div>
									<h4 className="mb-2 text-lg font-semibold">Security-First Design</h4>
									<p className="mb-4 text-sm text-muted-foreground">
										Every feature built with enterprise security requirements in mind
									</p>
									<Button
										size="lg"
										asChild
										className="bg-black text-white hover:bg-gray-800 hover:shadow-lg hover:shadow-black/20 dark:bg-white dark:text-black dark:hover:bg-gray-200 dark:hover:shadow-white/20 transition-all duration-300">
										<a
											href={EXTERNAL_LINKS.SECURITY}
											target="_blank"
											rel="noopener noreferrer"
											className="flex items-center">
											View Security Details
											<ArrowRight className="ml-2 h-4 w-4" />
										</a>
									</Button>
								</div>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* CTA Section */}
			<section id="contact" className="relative overflow-hidden py-20 sm:py-24">
				<div className="absolute inset-0 bg-gradient-to-b from-blue-500/5 via-cyan-500/5 to-purple-500/5 dark:from-blue-500/10 dark:via-cyan-500/10 dark:to-purple-500/10" />
				<div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-4xl">
						<div className="relative rounded-3xl border border-border/50 bg-gradient-to-br from-blue-500/5 via-cyan-500/5 to-purple-500/5 p-8 shadow-2xl backdrop-blur-xl dark:border-white/20 dark:bg-gradient-to-br dark:from-gray-800 dark:via-gray-900 dark:to-black dark:shadow-[0_30px_90px_rgba(255,255,255,0.15)] sm:p-12">
							<div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-blue-500/5 via-transparent to-purple-500/5 dark:bg-gradient-to-br dark:from-white/[0.05] dark:via-transparent dark:to-white/[0.03]" />
							<div className="relative text-center">
								<h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">
									Ready to Transform Your Development Process?
								</h2>
								<p className="mb-8 text-lg text-muted-foreground">
									Join our early access program and be among the first to experience the power of Roo
									Code Cloud for Enterprise.
								</p>
								<div className="grid gap-4 sm:grid-cols-2 sm:gap-6">
									<div className="rounded-lg border border-border bg-card/80 backdrop-blur-sm p-6 text-center shadow-lg hover:shadow-xl transition-all duration-300 dark:border-white/20 dark:bg-gray-800/80 dark:hover:border-white/40 dark:hover:bg-gray-700/90 dark:hover:shadow-[0_20px_50px_rgba(255,255,255,0.2)] dark:hover:scale-[1.02]">
										<h3 className="mb-2 text-xl font-bold">Become an Early Access Partner</h3>
										<p className="mb-4 text-muted-foreground">
											Collaborate in shaping Roo Code&apos;s enterprise solution.
										</p>
										<ContactForm
											formType="early-access"
											buttonText="Apply Now"
											buttonClassName="bg-black text-white hover:bg-gray-800 hover:shadow-lg hover:shadow-black/20 dark:bg-white dark:text-black dark:hover:bg-gray-200 dark:hover:shadow-white/20 transition-all duration-300"
										/>
									</div>
									<div className="rounded-lg border border-border bg-card/80 backdrop-blur-sm p-6 text-center shadow-lg hover:shadow-xl transition-all duration-300 dark:border-white/20 dark:bg-gray-800/80 dark:hover:border-white/40 dark:hover:bg-gray-700/90 dark:hover:shadow-[0_20px_50px_rgba(255,255,255,0.2)] dark:hover:scale-[1.02]">
										<h3 className="mb-2 text-xl font-bold">Request a Demo</h3>
										<p className="mb-4 text-muted-foreground">
											See Roo Code&apos;s enterprise capabilities in action.
										</p>
										<ContactForm
											formType="demo"
											buttonText="Contact Us"
											buttonClassName="bg-black text-white hover:bg-gray-800 hover:shadow-lg hover:shadow-black/20 dark:bg-white dark:text-black dark:hover:bg-gray-200 dark:hover:shadow-white/20 transition-all duration-300"
										/>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</section>
		</>
	)
}
