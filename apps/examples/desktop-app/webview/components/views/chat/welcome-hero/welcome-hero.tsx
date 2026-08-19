"use client";

import { useRef } from "react";
import { WELCOME_HERO_STYLE } from "./hero-config";
import { useWelcomeHeroPointer } from "./use-welcome-hero-pointer";
import styles from "./welcome-hero.module.css";

export interface WelcomeHeroProps {
	className?: string;
}

/** The cursor-reactive bot illustration used above the welcome composer. */
export function WelcomeHero({ className }: WelcomeHeroProps) {
	const heroRef = useRef<HTMLDivElement>(null);
	useWelcomeHeroPointer(heroRef);

	return (
		<div
			aria-hidden="true"
			className={className ? `${styles.root} ${className}` : styles.root}
			data-welcome-hero
			ref={heroRef}
			style={WELCOME_HERO_STYLE}
		>
			<div className={styles.grid} data-welcome-hero-layer="grid" />
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
		</div>
	);
}
