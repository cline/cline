import { Users, Building2, ArrowRight, Star, LucideIcon, Check, Cloud } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"

import { Button } from "@/components/ui"
import { AnimatedBackground } from "@/components/homepage"
import { ContactForm } from "@/components/enterprise/contact-form"
import { SEO } from "@/lib/seo"
import { EXTERNAL_LINKS } from "@/lib/constants"

const TITLE = "Pricing - Roo Code Cloud"
const DESCRIPTION =
	"Simple, transparent pricing for Roo Code Cloud. The VS Code extension is free forever. Choose the cloud plan that fits your needs."
const PATH = "/pricing"
const OG_IMAGE = SEO.ogImage

const PRICE_CREDITS = 5

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
	keywords: [
		...SEO.keywords,
		"pricing",
		"plans",
		"subscription",
		"cloud pricing",
		"AI development pricing",
		"team pricing",
		"enterprise pricing",
	],
}

interface PricingTier {
	name: string
	icon: LucideIcon
	price: string
	period?: string
	creditPrice?: string
	trial?: string
	cancellation?: string
	description: string
	featuresIntro?: string
	features: string[]
	cta: {
		text: string
		href?: string
		isContactForm?: boolean
	}
}

const pricingTiers: PricingTier[] = [
	{
		name: "Cloud Free",
		icon: Cloud,
		price: "$0",
		cancellation: "Cancel anytime",
		description: "For folks just getting started",
		features: [
			"Token usage analytics",
			"Follow your tasks from anywhere",
			"Share tasks with friends and co-workers",
			"Early access to free AI Models",
			"Community support",
		],
		cta: {
			text: "Get started",
			href: EXTERNAL_LINKS.CLOUD_APP_SIGNUP,
		},
	},
	{
		name: "Pro",
		icon: Star,
		price: "$20",
		period: "/mo",
		trial: "Free 14-day trial · ",
		creditPrice: `$${PRICE_CREDITS}`,
		cancellation: "Cancel anytime",
		description: "For pro Roo coders",
		featuresIntro: "Everything in Free +",
		features: [
			"Cloud Agents: PR Reviewer and more",
			"Roomote Control: Start, stop and control tasks from anywhere",
			"Paid support",
		],
		cta: {
			text: "Get started",
			href: EXTERNAL_LINKS.CLOUD_APP_SIGNUP + "?redirect_url=/billing",
		},
	},
	{
		name: "Team",
		icon: Users,
		price: "$99",
		period: "/mo",
		creditPrice: `$${PRICE_CREDITS}`,
		trial: "Free 14-day trial · ",
		cancellation: "Cancel anytime",
		description: "For AI-forward teams",
		featuresIntro: "Everything in Pro +",
		features: ["Unlimited users (no per-seat cost)", "Shared configuration & policies", "Centralized billing"],
		cta: {
			text: "Get started",
			href: EXTERNAL_LINKS.CLOUD_APP_SIGNUP + "?redirect_url=/billing",
		},
	},
]

export default function PricingPage() {
	return (
		<>
			<AnimatedBackground />

			{/* Hero Section */}
			<section className="relative overflow-hidden pt-16 pb-12">
				<div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
					<div className="text-center">
						<h1 className="text-5xl font-bold tracking-tight">Roo Code Cloud Pricing</h1>
						<p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
							Simple, transparent pricing that scales with your needs.
							<br />
							No inference markups. Free 14-day trials to kick the tires.
						</p>
					</div>
				</div>
			</section>

			{/* Free Extension Notice */}
			<div className="mx-auto max-w-6xl">
				<div className="rounded-xl p-4 mb-8 text-center bg-gradient-to-r from-blue-500/10 via-cyan-500/10 to-purple-500/10 border border-blue-500/20 dark:border-white/20">
					<p className="text-center">
						<strong className="font-semibold">The Roo Code extension is free! </strong>
						Roo Code Cloud is an optional service which takes it to the next level.
					</p>
				</div>
			</div>

			{/* Pricing Tiers */}
			<section className="">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-3">
						{pricingTiers.map((tier) => {
							const Icon = tier.icon
							return (
								<div
									key={tier.name}
									className="relative p-6 flex flex-col justify-start bg-background border rounded-2xl transition-all hover:shadow-lg">
									<div className="mb-6">
										<div className="flex items-center justify-between">
											<h3 className="text-2xl font-bold tracking-tight">{tier.name}</h3>
											<Icon className="size-6" />
										</div>
										<p className="text-sm text-muted-foreground">{tier.description}</p>
									</div>

									<div className="grow mb-8">
										<p className="text-sm text-muted-foreground font-light mb-2">
											{tier.featuresIntro}&nbsp;
										</p>
										<ul className="space-y-3 my-0 h-[148px]">
											{tier.features.map((feature) => (
												<li key={feature} className="flex items-start gap-2">
													<Check className="mt-0.5 h-4 w-4 text-muted-foreground shrink-0" />
													<span className="text-sm">{feature}</span>
												</li>
											))}
										</ul>
									</div>

									<p className="text-2xl mt-0 mb-1 tracking-tight">
										<strong>{tier.price}</strong>
										{tier.period}
									</p>

									{tier.creditPrice && (
										<p className="text-sm text-muted-foreground mb-1">
											+ {tier.creditPrice}/hour for Cloud tasks
										</p>
									)}

									<p className="text-xs text-muted-foreground mb-4">
										{tier.trial}
										{tier.cancellation}
									</p>

									{tier.cta.isContactForm ? (
										<ContactForm
											formType="demo"
											buttonText={tier.cta.text}
											buttonClassName="w-full transition-all duration-300"
										/>
									) : (
										<Button size="lg" className="w-full transition-all duration-300" asChild>
											<Link href={tier.cta.href!} className="flex items-center justify-center">
												{tier.cta.text}
											</Link>
										</Button>
									)}
								</div>
							)
						})}
					</div>
				</div>

				<div className="mx-auto grid max-w-6xl gap-4 mt-4 relative">
					<p className="bg-background border rounded-2xl p-6 text-center text-sm text-muted-foreground">
						<Building2 className="inline size-4 mr-2 mb-0.5" />
						Need SAML, advanced security, custom integrations or terms? Enterprise is for you.
						<Link
							href="/enterprise#contact"
							className="font-medium ml-1 text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300">
							Talk to Sales
						</Link>
						.
					</p>
				</div>
			</section>

			{/* Additional Information */}
			<section className="bg-background py-16 my-16 border-t border-b relative z-50">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-3xl text-center">
						<h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Frequently Asked Questions</h2>
					</div>
					<div className="mx-auto mt-12 grid max-w-5xl gap-8 md:grid-cols-2">
						<div className="rounded-lg border border-border bg-card p-6">
							<h3 className="font-semibold">Wait, is Roo Code free or not?</h3>
							<p className="mt-2 text-sm text-muted-foreground">
								Yes! The Roo Code VS Code extension is open source and free forever. The extension acts
								as a powerful AI coding assistant right in your editor. These are the prices for Roo
								Code Cloud.
							</p>
						</div>
						<div className="rounded-lg border border-border bg-card p-6">
							<h3 className="font-semibold">Is there a free trial?</h3>
							<p className="mt-2 text-sm text-muted-foreground">
								Yes, all paid plans come with a 14-day free trial to try out functionality.
							</p>
							<p className="mt-2 text-sm text-muted-foreground">
								To use Cloud Agents, you can buy credits.
							</p>
						</div>
						<div className="rounded-lg border border-border bg-card p-6">
							<h3 className="font-semibold">How do Cloud Agent credits work?</h3>
							<p className="mt-2 text-sm text-muted-foreground">
								Cloud Agents are a version of Roo running in the cloud without depending on your IDE.
								You can run as many as you want, and bring your own inference provider key.
							</p>
							<p className="mt-2 text-sm text-muted-foreground">
								To cover our infrastructure costs, we charge ${PRICE_CREDITS}/hour while the agent is
								running (independent of inference costs).
							</p>
							<p className="mt-2 text-sm text-muted-foreground">
								There are no markups, no tiers, no dumbing-down of models to increase our profit.
							</p>
						</div>
						<div className="rounded-lg border border-border bg-card p-6">
							<h3 className="font-semibold">Do I need a credit card for the free trial?</h3>
							<p className="mt-2 text-sm text-muted-foreground">
								Yes, but you won&apos;t be charged until your trial ends, except for credit purchases.
							</p>
							<p className="mt-2 text-sm text-muted-foreground">You can cancel anytime with one click.</p>
						</div>
						<div className="rounded-lg border border-border bg-card p-6">
							<h3 className="font-semibold">What payment methods do you accept?</h3>
							<p className="mt-2 text-sm text-muted-foreground">
								We accept all major credit cards, debit cards, and can arrange invoice billing for
								Enterprise customers.
							</p>
						</div>
						<div className="rounded-lg border border-border bg-card p-6">
							<h3 className="font-semibold">Can I change plans anytime?</h3>
							<p className="mt-2 text-sm text-muted-foreground">
								Yes, you can upgrade or downgrade your plan at any time. Changes will be reflected in
								your next billing cycle.
							</p>
						</div>
					</div>

					<div className="mt-12 text-center">
						<p className="text-muted-foreground">
							Still have questions?{" "}
							<a
								href={EXTERNAL_LINKS.DISCORD}
								target="_blank"
								rel="noopener noreferrer"
								className="font-medium text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300">
								Join our Discord
							</a>{" "}
							or{" "}
							<Link
								href="/enterprise#contact"
								className="font-medium text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300">
								contact our sales team
							</Link>
						</p>
					</div>
				</div>
			</section>

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
