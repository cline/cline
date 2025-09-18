import type { Metadata } from "next"
import { SEO } from "@/lib/seo"

const TITLE = "Cookie Policy"
const DESCRIPTION = "Learn about how Roo Code uses cookies to enhance your experience and provide our services."
const PATH = "/legal/cookies"
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
		type: "article",
	},
	twitter: {
		card: SEO.twitterCard,
		title: TITLE,
		description: DESCRIPTION,
		images: [OG_IMAGE.url],
	},
	keywords: [...SEO.keywords, "cookies", "privacy", "tracking", "analytics"],
}

export default function CookiePolicy() {
	return (
		<>
			<div className="container mx-auto px-4 py-12 sm:px-6 lg:px-8">
				<div className="prose prose-lg mx-auto max-w-4xl dark:prose-invert">
					<p className="text-muted-foreground">Updated: September 18, 2025</p>

					<h1 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">Cookie Policy</h1>

					<p className="lead">
						This Cookie Policy explains how Roo Code uses cookies and similar technologies to recognize you
						when you visit our website.
					</p>

					<h2 className="mt-12 text-2xl font-bold">What are cookies?</h2>
					<p>
						Cookies are small data files that are placed on your computer or mobile device when you visit a
						website. Cookies help make websites work more efficiently and provide reporting information.
					</p>

					<h2 className="mt-12 text-2xl font-bold">Cookies we use</h2>
					<p>
						We use a minimal number of cookies to provide essential functionality and improve your
						experience.
					</p>

					<div className="overflow-x-auto">
						<table className="min-w-full border-collapse border border-border">
							<thead>
								<tr className="bg-muted/50">
									<th className="border border-border px-4 py-3 text-left font-semibold">Provider</th>
									<th className="border border-border px-4 py-3 text-left font-semibold">Purpose</th>
									<th className="border border-border px-4 py-3 text-left font-semibold">Type</th>
									<th className="border border-border px-4 py-3 text-left font-semibold">Duration</th>
									<th className="border border-border px-4 py-3 text-left font-semibold">
										Example Cookies
									</th>
								</tr>
							</thead>
							<tbody>
								<tr>
									<td className="border border-border px-4 py-3 font-medium">Clerk</td>
									<td className="border border-border px-4 py-3">
										Authentication and session management
									</td>
									<td className="border border-border px-4 py-3">Essential</td>
									<td className="border border-border px-4 py-3">1 year and 1 month</td>
									<td className="border border-border px-4 py-3 font-mono text-sm">
										__client_uat*, __clerk_*
									</td>
								</tr>
								<tr className="bg-muted/25">
									<td className="border border-border px-4 py-3 font-medium">PostHog</td>
									<td className="border border-border px-4 py-3">
										Product analytics and feature usage tracking
									</td>
									<td className="border border-border px-4 py-3">
										Analytics (only with your consent)
									</td>
									<td className="border border-border px-4 py-3">1 year</td>
									<td className="border border-border px-4 py-3 font-mono text-sm">ph_*</td>
								</tr>
							</tbody>
						</table>
					</div>

					<p className="mt-4">
						<a
							href="https://clerk.com/legal/privacy"
							target="_blank"
							rel="noopener noreferrer"
							className="text-primary hover:underline">
							Clerk Privacy Policy
						</a>
					</p>
					<p>
						<a
							href="https://posthog.com/privacy"
							target="_blank"
							rel="noopener noreferrer"
							className="text-primary hover:underline">
							PostHog Privacy Policy
						</a>
					</p>

					<h2 className="mt-12 text-2xl font-bold">Essential cookies</h2>
					<p>
						Essential cookies are required for our website to operate. These include authentication cookies
						from Clerk that allow you to stay logged in to your account. These cookies cannot be disabled
						without losing core website functionality. The lawful basis for processing these cookies is our
						legitimate interest in providing secure access to our services.
					</p>

					<h2 className="mt-12 text-2xl font-bold">Analytics cookies</h2>
					<p>
						We use PostHog analytics cookies to understand how visitors interact with our website. This
						helps us improve our services and user experience. Analytics cookies are placed only if you give
						consent through our cookie banner. The lawful basis for processing these cookies is your
						consent, which you can withdraw at any time.
					</p>

					<h2 className="mt-12 text-2xl font-bold">Third-party services</h2>
					<p>
						Our blog at{" "}
						<a
							href="https://blog.roocode.com"
							target="_blank"
							rel="noopener noreferrer"
							className="text-primary hover:underline">
							blog.roocode.com
						</a>{" "}
						is hosted on Substack. When you visit it, Substack may set cookies for analytics,
						personalization, and advertising/marketing. These cookies are managed directly by Substack and
						are outside our control. You can read more in{" "}
						<a
							href="https://substack.com/privacy"
							target="_blank"
							rel="noopener noreferrer"
							className="text-primary hover:underline">
							Substack&apos;s Cookie Policy
						</a>
						.
					</p>

					<h2 className="mt-12 text-2xl font-bold">How to control cookies</h2>
					<p>You can control and manage cookies through your browser settings. Most browsers allow you to:</p>
					<ul>
						<li>View what cookies are stored on your device</li>
						<li>Delete cookies individually or all at once</li>
						<li>Block third-party cookies</li>
						<li>Block cookies from specific websites</li>
						<li>Block all cookies from being set</li>
						<li>Delete all cookies when you close your browser</li>
					</ul>
					<p>
						Please note that blocking essential cookies may prevent you from using certain features of our
						website, such as staying logged in to your account.
					</p>

					<h2 className="mt-12 text-2xl font-bold">Changes to this policy</h2>
					<p>
						We may update this Cookie Policy from time to time. When we make changes, we will update the
						date at the top of this policy. We encourage you to periodically review this policy to stay
						informed about our use of cookies.
					</p>

					<h2 className="mt-12 text-2xl font-bold">Contact us</h2>
					<p>
						If you have questions about our use of cookies, please contact us at{" "}
						<a href="mailto:privacy@roocode.com" className="text-primary hover:underline">
							privacy@roocode.com
						</a>
						.
					</p>
				</div>
			</div>
		</>
	)
}
