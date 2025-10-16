import {
	ArrowRight,
	ChartLine,
	Cloud,
	Lock,
	LucideIcon,
	Megaphone,
	MessageCircleQuestionMark,
	ReplaceAll,
	Router,
	Share2,
	Users,
} from "lucide-react"
import type { Metadata } from "next"

import { Button } from "@/components/ui"
import { AnimatedBackground } from "@/components/homepage"
import { SEO } from "@/lib/seo"
import { EXTERNAL_LINKS } from "@/lib/constants"
import Image from "next/image"

const TITLE = "Roo Code Cloud"
const DESCRIPTION =
	"Roo Code Cloud gives you and your team the tools to take AI-coding to the next level with cloud agents, remote control, and more."
const PATH = "/cloud"
const OG_IMAGE = SEO.ogImage

export const metadata: Metadata = {
	title: TITLE,
	description: DESCRIPTION,
	alternates: {
		canonical: `${SEO.url}${PATH}`,
	},
	openGraph: {
		title: TITLE,
		description: DESCRIPTION,
		url: `${SEO.url}${PATH}`,
		siteName: SEO.name,
		images: [
			{
				url: OG_IMAGE.url,
				width: OG_IMAGE.width,
				height: OG_IMAGE.height,
				alt: OG_IMAGE.alt,
			},
		],
		locale: SEO.locale,
		type: "website",
	},
	twitter: {
		card: SEO.twitterCard,
		title: TITLE,
		description: DESCRIPTION,
		images: [OG_IMAGE.url],
	},
	keywords: [...SEO.keywords, "cloud", "subscription", "cloud agents", "AI cloud development"],
}

interface Feature {
	icon: LucideIcon
	title: string
	description: string
	logos?: string[]
}

const cloudFeatures: Feature[] = [
	{
		icon: Router,
		title: "Roomote Control",
		description: "Control your IDE from anywhere and keep coding away from your computer.",
	},
	{
		icon: Cloud,
		title: "Cloud Agents",
		description:
			"Specialized agents running in the Cloud to get stuff done while you sleep, with a credit-based system that doesn't lock you in or dumb your models down.",
	},
	{
		icon: ReplaceAll,
		title: "Still Model-agnostic",
		description: "Bring your own provider key — no markup, lock-in, no restrictions.",
		logos: ["Anthropic", "OpenAI", "Gemini", "Grok", "Qwen", "Kimi", "Mistral", "Ollama"],
	},
	{
		icon: ChartLine,
		title: "Usage Analytics",
		description: "Detailed token analytics to help you optimize your costs and usage.",
	},
	{
		icon: Megaphone,
		title: "Early Model Access",
		description: "Get early, free access to new, stealth coding models as they become available.",
	},
	{
		icon: Share2,
		title: "Task Sharing",
		description: "Share tasks with friends and co-workers and let them follow your work.",
	},
	{
		icon: Users,
		title: "Team Management",
		description:
			"Manage your team and their access to tasks and resources, with centralized billing, analytics and configuration.",
	},
	{
		icon: Lock,
		title: "Secure and Private",
		description:
			"Your data is never used for training, and we're SOC2 Type 2 and GDPR compliant, following state-of-the-art security practices, with deep respect for your IP.",
	},
	{
		icon: MessageCircleQuestionMark,
		title: "Priority support",
		description: "Get quick help from the people who know Roo best.",
	},
]

// Workaround for next/image choking on these for some reason
import screenshotDark from "/public/heroes/cloud-screen.png"

export default function CloudPage() {
	return (
		<>
			<section className="relative flex md:h-[calc(80vh-theme(spacing.12))] items-center overflow-hidden">
				<AnimatedBackground />
				<div className="container relative flex items-center h-full z-10 mx-auto px-4 sm:px-6 lg:px-8">
					<div className="grid h-full relative gap-8 md:gap-12 lg:grid-cols-2 lg:gap-16">
						<div className="flex flex-col px-4 justify-center space-y-6 sm:space-y-8">
							<div>
								<h1 className="text-4xl font-bold tracking-tight mt-8 text-center md:text-left md:text-4xl lg:text-5xl lg:mt-0">
									Go <em>way</em> beyond the IDE
								</h1>
								<p className="mt-4 max-w-md text-lg text-muted-foreground text-center md:text-left sm:mt-6">
									Roo Code Cloud gives you (and your team) the tools to take AI-coding to the next
									level
								</p>
							</div>
							<div className="flex flex-col space-y-3 sm:flex-row sm:space-x-4 sm:space-y-0">
								<Button
									variant="outline"
									size="lg"
									className="w-full sm:w-auto bg-white/20 dark:bg-white/10 backdrop-blur-sm border border-black/40 dark:border-white/30 hover:border-blue-400 hover:bg-white/30 dark:hover:bg-white/20 hover:shadow-[0_0_20px_rgba(59,130,246,0.5)] transition-all duration-300">
									<a
										href={EXTERNAL_LINKS.CLOUD_APP_SIGNUP}
										target="_blank"
										rel="noopener noreferrer"
										className="flex w-full items-center justify-center">
										Start Free Trial
										<ArrowRight className="ml-2" />
									</a>
								</Button>
							</div>
						</div>
						<div className="flex items-center justify-end mx-auto h-full mt-8 lg:mt-0">
							<div className="md:w-[900px] md:h-[530px]  bg-black dark:bg-white relative rounded-md overflow-clip shadow-2xl">
								<div className="block">
									<Image
										src={screenshotDark}
										alt="Screenshot of Roo Code Cloud"
										className="max-w-full h-auto"
										width={2680}
										height={1784}
									/>
								</div>
							</div>
						</div>
					</div>
				</div>
			</section>

			<section className="relative overflow-hidden border-t border-border py-32">
				<div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto mb-12 md:mb-24 max-w-4xl text-center">
						<div>
							<h2 className="text-4xl font-bold tracking-tight sm:text-5xl">Power and Flexibility</h2>
							<p className="mt-6 text-lg text-muted-foreground">
								Code in the cloud, access free models, get usage analytics and more
							</p>
						</div>
					</div>

					<div className="relative mx-auto md:max-w-[1200px]">
						<ul className="grid grid-cols-1 place-items-center gap-6 md:grid-cols-2 lg:grid-cols-3 lg:gap-8">
							{cloudFeatures.map((feature, index) => {
								const Icon = feature.icon
								return (
									<li
										key={index}
										className="relative h-full border border-border rounded-2xl bg-background p-8 transition-all duration-300">
										<Icon className="size-6 text-foreground/80" />
										<h3 className="mb-3 mt-3 text-xl font-semibold text-foreground">
											{feature.title}
										</h3>
										<p className="leading-relaxed font-light text-muted-foreground">
											{feature.description}
										</p>
										{feature.logos && (
											<div className="mt-4 flex flex-wrap items-center gap-4">
												{feature.logos.map((logo) => (
													<Image
														key={logo}
														width={20}
														height={20}
														className="w-5 h-5 overflow-clip opacity-50 dark:invert"
														src={`/logos/${logo.toLowerCase()}.svg`}
														alt={`${logo} Logo`}
													/>
												))}
											</div>
										)}
									</li>
								)
							})}
						</ul>
					</div>
				</div>
			</section>

			<div id="faq"></div>

			{/* CTA Section */}
			<section className="py-20">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-4xl rounded-3xl border border-border/50 bg-gradient-to-br from-blue-500/5 via-cyan-500/5 to-purple-500/5 p-8 text-center shadow-2xl backdrop-blur-xl dark:border-white/20 dark:bg-gradient-to-br dark:from-gray-800 dark:via-gray-900 dark:to-black sm:p-12">
						<h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">Try Roo Code Cloud now</h2>
						<p className="mx-auto mb-8 max-w-2xl text-lg text-muted-foreground">Code from anywhere.</p>
						<div className="flex flex-col justify-center space-y-4 sm:flex-row sm:space-x-4 sm:space-y-0">
							<Button
								size="lg"
								className="bg-black text-white hover:bg-gray-800 hover:shadow-lg hover:shadow-black/20 dark:bg-white dark:text-black dark:hover:bg-gray-200 dark:hover:shadow-white/20 transition-all duration-300"
								asChild>
								<a
									href={EXTERNAL_LINKS.CLOUD_APP_SIGNUP}
									target="_blank"
									rel="noopener noreferrer"
									className="flex items-center justify-center">
									Create a free Cloud account
									<ArrowRight className="ml-2 h-4 w-4" />
								</a>
							</Button>
						</div>
					</div>
				</div>
			</section>
		</>
	)
}
