/* eslint-disable react/jsx-no-target-blank */

"use client"

import Link from "next/link"
import Image from "next/image"
import { useState } from "react"
import { RxGithubLogo } from "react-icons/rx"
import { VscVscode } from "react-icons/vsc"
import { HiMenu } from "react-icons/hi"
import { IoClose } from "react-icons/io5"

import { EXTERNAL_LINKS } from "@/lib/constants"
import { useLogoSrc } from "@/lib/hooks/use-logo-src"
import { ScrollButton } from "@/components/ui"
import ThemeToggle from "@/components/chromes/theme-toggle"

interface NavBarProps {
	stars: string | null
	downloads: string | null
}

export function NavBar({ stars, downloads }: NavBarProps) {
	const [isMenuOpen, setIsMenuOpen] = useState(false)
	const logoSrc = useLogoSrc()

	return (
		<header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
			<div className="container mx-auto flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
				<div className="flex items-center">
					<Link href="/" className="flex items-center">
						<Image src={logoSrc} alt="Roo Code Logo" width={120} height={40} className="h-8 w-auto" />
					</Link>
				</div>

				{/* Desktop Navigation */}
				<nav className="hidden text-sm font-medium md:flex md:items-center md:space-x-3 xl:space-x-8">
					{/* note: features and testimonials links are hidden for screen sizes smaller than lg */}
					<ScrollButton
						targetId="features"
						className="text-muted-foreground transition-transform duration-200 hover:scale-105 hover:text-foreground max-lg:hidden">
						Features
					</ScrollButton>
					<ScrollButton
						targetId="testimonials"
						className="text-muted-foreground transition-transform duration-200 hover:scale-105 hover:text-foreground max-lg:hidden">
						Testimonials
					</ScrollButton>
					<ScrollButton
						targetId="faq"
						className="text-muted-foreground transition-transform duration-200 hover:scale-105 hover:text-foreground">
						FAQ
					</ScrollButton>
					<Link
						href="/evals"
						className="text-muted-foreground transition-transform duration-200 hover:scale-105 hover:text-foreground">
						Evals
					</Link>
					<Link
						href="/enterprise"
						className="text-muted-foreground transition-transform duration-200 hover:scale-105 hover:text-foreground">
						Enterprise
					</Link>
					<a
						href={EXTERNAL_LINKS.DOCUMENTATION}
						target="_blank"
						className="text-muted-foreground transition-transform duration-200 hover:scale-105 hover:text-foreground">
						Documentation
					</a>
					<a
						href={EXTERNAL_LINKS.CAREERS}
						target="_blank"
						className="text-muted-foreground transition-transform duration-200 hover:scale-105 hover:text-foreground">
						Careers
					</a>
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
						className="hidden items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 md:flex">
						<VscVscode className="-mr-[2px] mt-[1px] h-4 w-4" />
						<span>
							Install <span className="font-black max-lg:text-xs">&middot;</span>
						</span>
						{downloads !== null && <span>{downloads}</span>}
					</Link>
				</div>

				{/* Mobile Menu Button */}
				<button
					aria-expanded={isMenuOpen}
					onClick={() => setIsMenuOpen(!isMenuOpen)}
					className="flex items-center justify-center rounded-full p-2 transition-colors hover:bg-accent md:hidden"
					aria-label="Toggle mobile menu">
					{isMenuOpen ? <IoClose className="h-6 w-6" /> : <HiMenu className="h-6 w-6" />}
				</button>
			</div>

			{/* Mobile Menu Panel */}
			<div
				className={`absolute left-0 right-0 top-16 z-50 transform border-b border-border bg-background shadow-lg backdrop-blur-none transition-all duration-200 md:hidden ${isMenuOpen ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-2 opacity-0"}`}>
				<nav className="flex flex-col py-2">
					<ScrollButton
						targetId="features"
						className="w-full px-8 py-3 text-left text-sm font-medium text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
						onClick={() => setIsMenuOpen(false)}>
						Features
					</ScrollButton>
					<ScrollButton
						targetId="testimonials"
						className="w-full px-8 py-3 text-left text-sm font-medium text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
						onClick={() => setIsMenuOpen(false)}>
						Testimonials
					</ScrollButton>
					<ScrollButton
						targetId="faq"
						className="w-full px-8 py-3 text-left text-sm font-medium text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
						onClick={() => setIsMenuOpen(false)}>
						FAQ
					</ScrollButton>
					<Link
						href="/evals"
						className="w-full px-8 py-3 text-left text-sm font-medium text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
						onClick={() => setIsMenuOpen(false)}>
						Evals
					</Link>
					<Link
						href="/enterprise"
						className="w-full px-8 py-3 text-left text-sm font-medium text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
						onClick={() => setIsMenuOpen(false)}>
						Enterprise
					</Link>
					<a
						href={EXTERNAL_LINKS.DOCUMENTATION}
						target="_blank"
						className="w-full px-8 py-3 text-left text-sm font-medium text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
						onClick={() => setIsMenuOpen(false)}>
						Documentation
					</a>
					<a
						href={EXTERNAL_LINKS.CAREERS}
						target="_blank"
						className="w-full px-8 py-3 text-left text-sm font-medium text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
						onClick={() => setIsMenuOpen(false)}>
						Careers
					</a>

					<hr className="mx-8 my-2 border-t border-border/50" />

					{/* Icons & Stats */}
					<div className="flex items-center justify-center gap-8 px-8 py-3">
						<Link
							href={EXTERNAL_LINKS.GITHUB}
							target="_blank"
							className="inline-flex items-center gap-2 rounded-md p-2 text-sm font-medium text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
							onClick={() => setIsMenuOpen(false)}>
							<RxGithubLogo className="h-5 w-5" />
							{stars !== null && <span>{stars}</span>}
						</Link>
						<div className="flex items-center rounded-md p-2 transition-colors hover:bg-accent">
							<ThemeToggle />
						</div>
						<Link
							href={EXTERNAL_LINKS.MARKETPLACE}
							target="_blank"
							className="inline-flex items-center gap-2 rounded-md p-2 text-sm font-medium text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
							onClick={() => setIsMenuOpen(false)}>
							<VscVscode className="h-5 w-5" />
							{downloads !== null && <span>{downloads}</span>}
						</Link>
					</div>
				</nav>
			</div>
		</header>
	)
}
