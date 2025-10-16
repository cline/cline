/* eslint-disable react/jsx-no-target-blank */

"use client"

import Link from "next/link"
import Image from "next/image"
import { useState } from "react"
import { RxGithubLogo } from "react-icons/rx"
import { VscVscode } from "react-icons/vsc"
import { HiMenu } from "react-icons/hi"

import { EXTERNAL_LINKS } from "@/lib/constants"
import { useLogoSrc } from "@/lib/hooks/use-logo-src"
import { ScrollButton } from "@/components/ui"
import ThemeToggle from "@/components/chromes/theme-toggle"
import { ChevronDown, Cloud, X } from "lucide-react"

interface NavBarProps {
	stars: string | null
	downloads: string | null
}

export function NavBar({ stars, downloads }: NavBarProps) {
	const [isMenuOpen, setIsMenuOpen] = useState(false)
	const logoSrc = useLogoSrc()

	return (
		<header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
			<div className="container flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
				<div className="flex items-center">
					<Link href="/" className="flex items-center">
						<Image src={logoSrc} alt="Roo Code Logo" width={130} height={24} className="h-[24px] w-auto" />
					</Link>
				</div>

				{/* Desktop Navigation */}
				<nav className="grow ml-6 hidden text-sm font-medium md:flex md:items-center">
					<ScrollButton
						targetId="product"
						className="text-muted-foreground px-4 py-6 transition-transform duration-200 hover:scale-105 hover:text-foreground max-lg:hidden">
						Extension
					</ScrollButton>
					<Link
						href="/cloud"
						className="text-muted-foreground px-4 py-6 transition-transform duration-200 hover:scale-105 hover:text-foreground">
						Cloud
					</Link>
					<a
						href={EXTERNAL_LINKS.DOCUMENTATION}
						target="_blank"
						className="text-muted-foreground px-4 py-6 transition-transform duration-200 hover:scale-105 hover:text-foreground">
						Docs
					</a>
					<Link
						href="/pricing"
						className="text-muted-foreground px-4 py-6 transition-transform duration-200 hover:scale-105 hover:text-foreground">
						Pricing
					</Link>
					{/* Resources Dropdown */}
					<div className="relative group">
						<button className="flex items-center px-4 py-6 gap-1 text-muted-foreground transition-transform duration-200 hover:scale-105 hover:text-foreground">
							Resources
							<ChevronDown className="size-3" />
						</button>
						{/* Dropdown Menu */}
						<div className="absolute left-0 top-12 mt-2 w-40 rounded-md border border-border bg-background py-1 shadow-lg opacity-0 -translate-y-2 pointer-events-none group-hover:opacity-100 group-hover:translate-y-0 group-hover:pointer-events-auto transition-all duration-200">
							<ScrollButton
								targetId="faq"
								className="block px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
								FAQ
							</ScrollButton>
							<Link
								href="/evals"
								className="block px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
								Evals
							</Link>
							<a
								href={EXTERNAL_LINKS.DISCORD}
								target="_blank"
								rel="noopener noreferrer"
								className="block px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
								Discord
							</a>
							<a
								href={EXTERNAL_LINKS.SECURITY}
								target="_blank"
								rel="noopener noreferrer"
								className="block px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
								onClick={() => setIsMenuOpen(false)}>
								Trust Center
							</a>
						</div>
					</div>
				</nav>

				<div className="hidden md:flex md:items-center md:space-x-4">
					<div className="flex flex-row space-x-2">
						<ThemeToggle />
						<Link
							href={EXTERNAL_LINKS.GITHUB}
							target="_blank"
							className="hidden items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground md:flex">
							<RxGithubLogo className="h-4 w-4" />
							{stars !== null && <span>{stars}</span>}
						</Link>
					</div>
					<Link
						href={EXTERNAL_LINKS.MARKETPLACE}
						target="_blank"
						className="hidden items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-all duration-200 hover:shadow-lg hover:scale-105 md:flex">
						<VscVscode className="-mr-[2px] mt-[1px] h-4 w-4" />
						<span>
							Install <span className="font-black max-lg:text-xs">&middot;</span>
						</span>
						{downloads !== null && <span>{downloads}</span>}
					</Link>
					<a
						href={EXTERNAL_LINKS.CLOUD_APP_LOGIN}
						target="_blank"
						rel="noopener noreferrer"
						className="hidden items-center gap-1.5 rounded-md py-2 text-sm border border-primary-background px-4 font-medium text-primary-background transition-all duration-200 hover:shadow-lg hover:scale-105 md:flex">
						<Cloud className="inline h-4 w-4" />
						Log in
					</a>
				</div>

				{/* Mobile Menu Button */}
				<button
					aria-expanded={isMenuOpen}
					onClick={() => setIsMenuOpen(!isMenuOpen)}
					className="relative z-10 flex items-center justify-center rounded-full p-2 transition-colors hover:bg-accent md:hidden"
					aria-label="Toggle mobile menu">
					<HiMenu className={`h-6 w-6 ${isMenuOpen ? "hidden" : "block"}`} />
					<X className={`h-6 w-6 ${isMenuOpen ? "block" : "hidden"}`} />
				</button>
			</div>

			{/* Mobile Menu Panel - Full Screen */}
			<div
				className={`fixed top-16 left-0 bg-background right-0 z-[100] transition-all duration-200 pointer-events-none md:hidden ${isMenuOpen ? "block h-dvh" : "hidden"}`}>
				<nav className="flex flex-col justify-between h-full pb-16 overflow-y-auto bg-background pointer-events-auto">
					{/* Main navigation items */}
					<div className="grow-1 py-4 font-semibold text-lg">
						<ScrollButton
							targetId="product"
							className="block w-full p-5 py-3 text-left text-foreground active:opacity-50"
							onClick={() => setIsMenuOpen(false)}>
							Extension
						</ScrollButton>
						<Link
							href="/cloud"
							className="block w-full p-5 text-left text-foreground active:opacity-50"
							onClick={() => setIsMenuOpen(false)}>
							Cloud
						</Link>
						<a
							href={EXTERNAL_LINKS.DOCUMENTATION}
							target="_blank"
							className="block w-full p-5 text-left text-foreground active:opacity-50"
							onClick={() => setIsMenuOpen(false)}>
							Docs
						</a>
						<Link
							href="/pricing"
							className="block w-full p-5 text-left text-foreground active:opacity-50"
							onClick={() => setIsMenuOpen(false)}>
							Pricing
						</Link>

						{/* Resources Section */}
						<div className="mt-4 w-full">
							<div className="px-5 pb-2 pt-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
								Resources
							</div>
							<ScrollButton
								targetId="faq"
								className="block w-full p-5 py-3 text-left text-foreground active:opacity-50"
								onClick={() => setIsMenuOpen(false)}>
								FAQ
							</ScrollButton>
							<Link
								href="/evals"
								className="block w-full p-5 py-3 text-left text-foreground active:opacity-50"
								onClick={() => setIsMenuOpen(false)}>
								Evals
							</Link>
							<a
								href={EXTERNAL_LINKS.DISCORD}
								target="_blank"
								rel="noopener noreferrer"
								className="block w-full p-5 py-3 text-left text-foreground active:opacity-50"
								onClick={() => setIsMenuOpen(false)}>
								Discord
							</a>
							<a
								href={EXTERNAL_LINKS.SECURITY}
								target="_blank"
								rel="noopener noreferrer"
								className="block w-full p-5 py-3 text-left text-foreground active:opacity-50"
								onClick={() => setIsMenuOpen(false)}>
								Security Center
							</a>
						</div>
					</div>

					{/* Bottom section with Cloud Login and stats */}
					<div className="border-t border-border">
						<div className="flex items-center justify-around px-6 pt-2">
							<Link
								href={EXTERNAL_LINKS.GITHUB}
								target="_blank"
								className="inline-flex items-center gap-2 rounded-md p-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
								onClick={() => setIsMenuOpen(false)}>
								<RxGithubLogo className="h-6 w-6" />
								{stars !== null && <span>{stars}</span>}
							</Link>
							<div className="flex items-center rounded-md p-3 transition-colors hover:bg-accent">
								<ThemeToggle />
							</div>
							<Link
								href={EXTERNAL_LINKS.MARKETPLACE}
								target="_blank"
								className="inline-flex items-center gap-2 rounded-md p-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
								onClick={() => setIsMenuOpen(false)}>
								<VscVscode className="h-6 w-6" />
								{downloads !== null && <span>{downloads}</span>}
							</Link>
						</div>
						<a
							href={EXTERNAL_LINKS.CLOUD_APP_LOGIN}
							target="_blank"
							rel="noopener noreferrer"
							className="flex items-center justify-center gap-2 rounded-lg border border-primary bg-background p-4 mx-4 mb-4 text-base font-semibold text-primary"
							onClick={() => setIsMenuOpen(false)}>
							<Cloud className="h-5 w-5" />
							Log in
						</a>
					</div>
				</nav>
			</div>
		</header>
	)
}
