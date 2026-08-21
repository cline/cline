"use client";

import { clsx } from "clsx";
import { useRef } from "react";
import { useWelcomeHeroPointer } from "./use-welcome-hero-pointer";
import styles from "./welcome-hero.module.css";

export type WelcomeHeroLayout = "default" | "full-bleed" | "wide-grid";

export interface WelcomeHeroProps {
	className?: string;
	interactive?: boolean;
	layout?: WelcomeHeroLayout;
	variant?: "full" | "grid-only" | "bot-only";
}

/** Composable welcome bot illustration and grid backdrop. */
export function WelcomeHero({
	className,
	interactive,
	layout = "default",
	variant = "full",
}: WelcomeHeroProps) {
	const heroRef = useRef<HTMLDivElement>(null);
	const showsGrid = variant !== "bot-only";
	const showsBot = variant !== "grid-only";
	const tracksPointer = interactive ?? showsBot;
	useWelcomeHeroPointer(heroRef, tracksPointer);

	return (
		<div
			aria-hidden="true"
			className={clsx(styles.root, className)}
			data-welcome-hero
			data-welcome-hero-interactive={tracksPointer}
			data-welcome-hero-layout={layout}
			data-welcome-hero-variant={variant}
			ref={heroRef}
		>
			{showsGrid ? (
				<div className={styles.grid} data-welcome-hero-layer="grid" />
			) : null}
			{showsBot ? (
				<>
					<span className={styles.inner} data-welcome-hero-layer="inner" />
					<span className={styles.botFill} data-welcome-hero-layer="bot-fill" />
					<span
						className={styles.botOutline}
						data-welcome-hero-layer="bot-outline"
					/>
					<span
						className={`${styles.eye} ${styles.eyeLeft}`}
						data-welcome-hero-eye="left"
					/>
					<span
						className={`${styles.eye} ${styles.eyeRight}`}
						data-welcome-hero-eye="right"
					/>
				</>
			) : null}
		</div>
	);
}
