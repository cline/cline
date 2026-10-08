"use client";

import { useEffect, useState } from "react";
import { CONCEPTS } from "@/components/concepts/file-viewer/concepts";

export default function FileViewerConceptsPage() {
	const [id, setId] = useState<number | null>(null);

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const theme = params.get("theme");
		if (theme === "dark" || theme === "light") {
			document.documentElement.classList.toggle("dark", theme === "dark");
		}
		setId(Number(params.get("c")) || 1);
	}, []);

	const concept = CONCEPTS.find((entry) => entry.id === id);
	return concept ? <concept.Component /> : null;
}
