import { EmptyRequest } from "@shared/proto/cline/common"
import type { SystemInfo } from "@shared/proto/cline/models"
import React, { useState } from "react"
import { ModelsServiceClient } from "@/services/grpc-client"

interface SystemInfoDisplayProps {
	className?: string
}

const SystemInfoDisplay: React.FC<SystemInfoDisplayProps> = ({ className = "" }) => {
	const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const fetchSystemInfo = async () => {
		setLoading(true)
		setError(null)

		try {
			// 与项目中其他 gRPC 调用方式保持一致
			const info = await ModelsServiceClient.getSystemInfo(EmptyRequest.create({}))
			setSystemInfo(info)
		} catch (err) {
			console.error("Failed to fetch system info:", err)
			setError(err instanceof Error ? err.message : "Unknown error occurred")
		} finally {
			setLoading(false)
		}
	}

	const formatBytes = (bytes: number): string => {
		if (bytes === 0) return "0 Bytes"

		const k = 1024
		const sizes = ["Bytes", "KB", "MB", "GB", "TB"]
		const i = Math.floor(Math.log(bytes) / Math.log(k))

		return parseFloat((bytes / k ** i).toFixed(2)) + " " + sizes[i]
	}

	const formatUptime = (seconds: number): string => {
		const days = Math.floor(seconds / (24 * 3600))
		seconds %= 24 * 3600
		const hours = Math.floor(seconds / 3600)
		seconds %= 3600
		const minutes = Math.floor(seconds / 60)

		let result = ""
		if (days > 0) result += `${days}d `
		if (hours > 0) result += `${hours}h `
		if (minutes > 0) result += `${minutes}m`

		return result.trim() || "0m"
	}

	return (
		<div className={`p-4 bg-gray-800 rounded-lg ${className}`}>
			<div className="flex items-center justify-between mb-4">
				<h2 className="text-lg font-semibold text-white">System Information</h2>
				<button
					className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded transition-colors"
					disabled={loading}
					onClick={fetchSystemInfo}>
					{loading ? "Loading..." : "Refresh"}
				</button>
			</div>

			{error && <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded text-red-200">Error: {error}</div>}

			{systemInfo ? (
				<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
					<div className="bg-gray-700/50 p-3 rounded">
						<h3 className="text-sm font-medium text-gray-300 mb-2">Basic Info</h3>
						<div className="space-y-1 text-sm">
							<div className="flex justify-between">
								<span className="text-gray-400">Platform:</span>
								<span className="text-white">{systemInfo.platform}</span>
							</div>
							<div className="flex justify-between">
								<span className="text-gray-400">Architecture:</span>
								<span className="text-white">{systemInfo.arch}</span>
							</div>
							<div className="flex justify-between">
								<span className="text-gray-400">Hostname:</span>
								<span className="text-white">{systemInfo.hostname}</span>
							</div>
						</div>
					</div>

					<div className="bg-gray-700/50 p-3 rounded">
						<h3 className="text-sm font-medium text-gray-300 mb-2">Hardware</h3>
						<div className="space-y-1 text-sm">
							<div className="flex justify-between">
								<span className="text-gray-400">CPU Cores:</span>
								<span className="text-white">{systemInfo.cpuCount}</span>
							</div>
							<div className="flex justify-between">
								<span className="text-gray-400">Total Memory:</span>
								<span className="text-white">{formatBytes(systemInfo.totalMemory)}</span>
							</div>
							<div className="flex justify-between">
								<span className="text-gray-400">Free Memory:</span>
								<span className="text-white">{formatBytes(systemInfo.freeMemory)}</span>
							</div>
						</div>
					</div>

					<div className="bg-gray-700/50 p-3 rounded md:col-span-2">
						<h3 className="text-sm font-medium text-gray-300 mb-2">System Uptime</h3>
						<div className="text-lg font-mono text-green-400">{formatUptime(systemInfo.uptime)}</div>
					</div>
				</div>
			) : (
				!loading &&
				!error && (
					<div className="text-center py-8 text-gray-400">
						<p>Click "Refresh" to fetch system information</p>
					</div>
				)
			)}

			{loading && !systemInfo && (
				<div className="flex justify-center py-8">
					<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
				</div>
			)}
		</div>
	)
}

export default SystemInfoDisplay
