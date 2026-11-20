import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function formatNumber(value: number, maximumFractionDigits = 0): string {
	return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}

export function formatCompact(value: number): string {
	return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
		value,
	);
}

export function formatUsd(value: number): string {
	if (!Number.isFinite(value)) return "$0.00";
	if (value === 0) return "$0.00";
	if (value < 0.01) return `$${value.toFixed(4)}`;
	return `$${value.toFixed(2)}`;
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatRelativeTime(iso: string | null | undefined): string {
	if (!iso) return "—";
	const date = new Date(iso);
	const diff = Date.now() - date.getTime();
	const seconds = Math.round(diff / 1000);
	if (seconds < 45) return "just now";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.round(hours / 24);
	if (days < 30) return `${days}d ago`;
	return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
	if (!iso) return "—";
	return new Date(iso).toLocaleString("en-US", {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

export function truncate(value: string, max: number): string {
	if (value.length <= max) return value;
	return `${value.slice(0, max)}\n… (${value.length - max} more characters)`;
}

export function initials(name: string | null | undefined, email: string | null | undefined) {
	const source = name?.trim() || email?.split("@")[0] || "21";
	const parts = source.split(/[\s._-]+/).filter(Boolean);
	return (parts[0]?.[0] ?? "2").toUpperCase() + (parts[1]?.[0] ?? "1").toUpperCase();
}

export function statusTone(status: string): "success" | "danger" | "warning" | "info" | "muted" {
	switch (status) {
		case "succeeded":
		case "ready":
		case "active":
			return "success";
		case "failed":
		case "error":
		case "deleted":
			return "danger";
		case "running":
		case "provisioning":
		case "queued":
			return "info";
		case "waiting_approval":
		case "cancelled":
		case "stopped":
			return "warning";
		default:
			return "muted";
	}
}

export function humanizeStatus(status: string): string {
	return status.replaceAll("_", " ");
}

export function safeJson<T>(value: unknown, fallback: T): T {
	if (value && typeof value === "object") return value as T;
	return fallback;
}
