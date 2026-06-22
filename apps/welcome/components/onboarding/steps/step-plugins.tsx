"use client";

import { motion } from "framer-motion";
import { Check } from "lucide-react";

interface StepPluginsProps {
	selected: string[];
	onToggle: (plugin: string) => void;
}

const plugins = [
	{ id: "linear", name: "Linear", category: "Project Management" },
	{ id: "gmail", name: "Gmail", category: "Email" },
	{ id: "google-docs", name: "Google Docs", category: "Documents" },
	{ id: "slack", name: "Slack", category: "Communication" },
	{ id: "notion", name: "Notion", category: "Notes" },
	{ id: "github", name: "GitHub", category: "Development" },
	{ id: "calendar", name: "Google Calendar", category: "Scheduling" },
	{ id: "jira", name: "Jira", category: "Project Management" },
	{ id: "figma", name: "Figma", category: "Design" },
	{ id: "dropbox", name: "Dropbox", category: "Storage" },
	{ id: "trello", name: "Trello", category: "Tasks" },
	{ id: "asana", name: "Asana", category: "Tasks" },
];

export function StepPlugins({ selected, onToggle }: StepPluginsProps) {
	return (
		<div className="text-center px-4">
			<motion.h2
				initial={{ opacity: 0, y: -10 }}
				animate={{ opacity: 1, y: 0 }}
				className="text-2xl sm:text-3xl font-bold text-foreground mb-3 text-balance"
			>
				Add plugins
			</motion.h2>
			<motion.p
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				transition={{ delay: 0.1 }}
				className="text-muted-foreground mb-6 text-sm sm:text-base"
			>
				Give your agent extra powers
			</motion.p>

			<motion.p
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				transition={{ delay: 0.15 }}
				className="text-xs text-muted-foreground mb-6"
			>
				{selected.length} selected
			</motion.p>

			<div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3 max-w-xl mx-auto">
				{plugins.map((plugin, index) => {
					const isSelected = selected.includes(plugin.id);

					return (
						<motion.button
							key={plugin.id}
							initial={{ opacity: 0, scale: 0.9 }}
							animate={{ opacity: 1, scale: 1 }}
							transition={{ delay: index * 0.03 }}
							onClick={() => onToggle(plugin.id)}
							className={`relative p-3 sm:p-4 rounded-xl border-2 text-left transition-all ${
								isSelected
									? "border-primary bg-primary/5"
									: "border-border bg-card hover:border-primary/50"
							}`}
						>
							{isSelected && (
								<motion.div
									initial={{ scale: 0 }}
									animate={{ scale: 1 }}
									className="absolute top-2 right-2 w-5 h-5 bg-primary rounded-full flex items-center justify-center"
								>
									<Check className="w-3 h-3 text-primary-foreground" />
								</motion.div>
							)}
							<h3 className="font-medium text-foreground text-sm sm:text-base truncate pr-6">
								{plugin.name}
							</h3>
							<p className="text-xs text-muted-foreground truncate">
								{plugin.category}
							</p>
						</motion.button>
					);
				})}
			</div>
		</div>
	);
}
