import type { Metadata } from "next"
import { SEO } from "@/lib/seo"

const TITLE = "Subprocessors"
const DESCRIPTION = "List of third-party subprocessors used by Roo Code to process customer data."
const PATH = "/legal/subprocessors"
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
	keywords: [...SEO.keywords, "subprocessors", "data processing", "GDPR", "privacy", "third-party services"],
}

export default function SubProcessors() {
	return (
		<>
			<div className="container mx-auto px-4 py-12 sm:px-6 lg:px-8">
				<div className="prose prose-lg mx-auto max-w-5xl dark:prose-invert">
					<p className="text-muted-foreground">Updated: September 18, 2025</p>

					<h1 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">Subprocessors</h1>

					<p className="lead">Roo Code engages the following third parties to process Customer Data.</p>

					<div className="overflow-x-auto">
						<table className="min-w-full border-collapse border border-border">
							<thead>
								<tr className="bg-muted/50">
									<th className="border border-border px-4 py-3 text-left font-semibold">
										Entity Name
									</th>
									<th className="border border-border px-4 py-3 text-left font-semibold">
										Product or Service
									</th>
									<th className="border border-border px-4 py-3 text-left font-semibold">
										Location of Processing
									</th>
									<th className="border border-border px-4 py-3 text-left font-semibold">
										Purpose of Processing
									</th>
								</tr>
							</thead>
							<tbody>
								<tr>
									<td className="border border-border px-4 py-3 font-medium">Census</td>
									<td className="border border-border px-4 py-3">Data Services</td>
									<td className="border border-border px-4 py-3">United States</td>
									<td className="border border-border px-4 py-3">Data activation and reverse ETL</td>
								</tr>
								<tr className="bg-muted/25">
									<td className="border border-border px-4 py-3 font-medium">Clerk</td>
									<td className="border border-border px-4 py-3">Authentication Services</td>
									<td className="border border-border px-4 py-3">United States</td>
									<td className="border border-border px-4 py-3">User authentication</td>
								</tr>
								<tr>
									<td className="border border-border px-4 py-3 font-medium">ClickHouse</td>
									<td className="border border-border px-4 py-3">Data Services</td>
									<td className="border border-border px-4 py-3">United States</td>
									<td className="border border-border px-4 py-3">Real-time analytics database</td>
								</tr>
								<tr className="bg-muted/25">
									<td className="border border-border px-4 py-3 font-medium">Cloudflare</td>
									<td className="border border-border px-4 py-3">All Services</td>
									<td className="border border-border px-4 py-3">
										Processing at data center closest to End User
									</td>
									<td className="border border-border px-4 py-3">
										Content delivery network and security
									</td>
								</tr>
								<tr>
									<td className="border border-border px-4 py-3 font-medium">Fivetran</td>
									<td className="border border-border px-4 py-3">Data Services</td>
									<td className="border border-border px-4 py-3">United States</td>
									<td className="border border-border px-4 py-3">ETL and data integration</td>
								</tr>
								<tr className="bg-muted/25">
									<td className="border border-border px-4 py-3 font-medium">Fly.io</td>
									<td className="border border-border px-4 py-3">Backend Services</td>
									<td className="border border-border px-4 py-3">United States</td>
									<td className="border border-border px-4 py-3">
										Application hosting and deployment
									</td>
								</tr>
								<tr>
									<td className="border border-border px-4 py-3 font-medium">HubSpot</td>
									<td className="border border-border px-4 py-3">Customer Services</td>
									<td className="border border-border px-4 py-3">United States</td>
									<td className="border border-border px-4 py-3">CRM and marketing automation</td>
								</tr>
								<tr className="bg-muted/25">
									<td className="border border-border px-4 py-3 font-medium">Loops</td>
									<td className="border border-border px-4 py-3">Communication Services</td>
									<td className="border border-border px-4 py-3">United States</td>
									<td className="border border-border px-4 py-3">Email and customer communication</td>
								</tr>
								<tr>
									<td className="border border-border px-4 py-3 font-medium">Metabase</td>
									<td className="border border-border px-4 py-3">Data Analytics</td>
									<td className="border border-border px-4 py-3">United States</td>
									<td className="border border-border px-4 py-3">
										Business intelligence and reporting
									</td>
								</tr>
								<tr className="bg-muted/25">
									<td className="border border-border px-4 py-3 font-medium">PostHog</td>
									<td className="border border-border px-4 py-3">Data Services</td>
									<td className="border border-border px-4 py-3">United States</td>
									<td className="border border-border px-4 py-3">Product analytics</td>
								</tr>
								<tr>
									<td className="border border-border px-4 py-3 font-medium">Sentry</td>
									<td className="border border-border px-4 py-3">All Services</td>
									<td className="border border-border px-4 py-3">United States</td>
									<td className="border border-border px-4 py-3">Error tracking and monitoring</td>
								</tr>
								<tr className="bg-muted/25">
									<td className="border border-border px-4 py-3 font-medium">Snowflake</td>
									<td className="border border-border px-4 py-3">Data Services</td>
									<td className="border border-border px-4 py-3">United States</td>
									<td className="border border-border px-4 py-3">Data warehousing and analytics</td>
								</tr>
								<tr>
									<td className="border border-border px-4 py-3 font-medium">Stripe</td>
									<td className="border border-border px-4 py-3">Payment Services</td>
									<td className="border border-border px-4 py-3">United States, Europe</td>
									<td className="border border-border px-4 py-3">Payment processing and billing</td>
								</tr>
								<tr className="bg-muted/25">
									<td className="border border-border px-4 py-3 font-medium">Supabase</td>
									<td className="border border-border px-4 py-3">Data Services</td>
									<td className="border border-border px-4 py-3">United States</td>
									<td className="border border-border px-4 py-3">Database management and storage</td>
								</tr>
								<tr>
									<td className="border border-border px-4 py-3 font-medium">Upstash</td>
									<td className="border border-border px-4 py-3">Infrastructure Services</td>
									<td className="border border-border px-4 py-3">United States</td>
									<td className="border border-border px-4 py-3">Serverless database services</td>
								</tr>
								<tr className="bg-muted/25">
									<td className="border border-border px-4 py-3 font-medium">Vercel</td>
									<td className="border border-border px-4 py-3">Customer-facing Services</td>
									<td className="border border-border px-4 py-3">United States, Europe</td>
									<td className="border border-border px-4 py-3">
										Web application hosting and deployment
									</td>
								</tr>
							</tbody>
						</table>
					</div>
				</div>
			</div>
		</>
	)
}
