/** A still, locally drawn question pose, legible at the same 28px as the dances. */
export function CuriousCompanionPose() {
	return (
		<svg
			aria-hidden="true"
			focusable="false"
			viewBox="0 0 56 56"
			className="pointer-events-none block size-[28px] shrink-0 opacity-70 grayscale"
			fill="none"
		>
			<g
				fill="#fafafa"
				stroke="#343434"
				strokeWidth="1.7"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				{/* A planted stance and a relaxed arm distinguish waiting from a dance. */}
				<path d="M21 32.5 18.5 44.5 15 48.5Q14 51 17 51H23L27 42 30 51H36Q39 51 37.5 48.5L34 44 32.5 33Z" />
				<path d="M20 35.5 16 39 14.5 44Q14 46 16 46.5 18 47 19 44.5L21.5 40" />
				{/* The head leans toward the user, with one eye lifted in curiosity. */}
				<g transform="rotate(-12 27 23)">
					<path d="M23 10V8Q23 4 27 4T31 8V10" />
					<path d="M10 19 6 23 10 27M44 19 48 23 44 27" />
					<rect x="10" y="10" width="34" height="25" rx="7" />
					<rect
						x="18"
						y="17"
						width="4.5"
						height="11"
						rx="2.25"
						fill="#343434"
						stroke="none"
					/>
					<rect
						x="31"
						y="15.5"
						width="4.5"
						height="12.5"
						rx="2.25"
						fill="#343434"
						stroke="none"
					/>
				</g>
				{/* A hand tucked under the chin makes this an authored waiting pose. */}
				<path d="M34 42Q41 42 40 37L36 32Q34.5 30 32.5 31.5 31 33 33 35L35 37 30 37" />
			</g>
			<path
				d="M45 7.5C45 3 51.5 3 51.5 7 51.5 9.5 48 9.5 48 12"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
			/>
			<circle cx="48" cy="15.5" r="1.1" fill="currentColor" />
		</svg>
	);
}
