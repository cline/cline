export interface GeoPoint {
	lon: number
	lat: number
}

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
	const R = 6371
	const dLat = ((b.lat - a.lat) * Math.PI) / 180
	const dLon = ((b.lon - a.lon) * Math.PI) / 180
	const lat1 = (a.lat * Math.PI) / 180
	const lat2 = (b.lat * Math.PI) / 180
	const sinDLat2 = Math.sin(dLat / 2)
	const sinDLon2 = Math.sin(dLon / 2)
	const c =
		2 *
		Math.atan2(
			Math.sqrt(sinDLat2 * sinDLat2 + Math.cos(lat1) * Math.cos(lat2) * sinDLon2 * sinDLon2),
			Math.sqrt(1 - (sinDLat2 * sinDLat2 + Math.cos(lat1) * Math.cos(lat2) * sinDLon2 * sinDLon2)),
		)
	return R * c
}

export function polygonAreaKm2(points: GeoPoint[]): number {
	if (points.length < 3) {
		return 0
	}
	let area = 0
	for (let i = 0; i < points.length; i++) {
		const j = (i + 1) % points.length
		area += points[i].lon * points[j].lat
		area -= points[j].lon * points[i].lat
	}
	const avgLat = points.reduce((s, p) => s + p.lat, 0) / points.length
	const kmPerDegLat = 111.32
	const kmPerDegLon = 111.32 * Math.cos((avgLat * Math.PI) / 180)
	return Math.abs(area) * 0.5 * kmPerDegLat * kmPerDegLon
}

export function lineLengthKm(points: GeoPoint[]): number {
	let total = 0
	for (let i = 1; i < points.length; i++) {
		total += haversineKm(points[i - 1], points[i])
	}
	return total
}

export function fmtDist(km: number): string {
	if (km < 1) {
		return `${(km * 1000).toFixed(0)} m`
	}
	if (km < 10) {
		return `${km.toFixed(2)} km`
	}
	if (km < 100) {
		return `${km.toFixed(1)} km`
	}
	return `${km.toFixed(0)} km`
}

export function fmtArea(km2: number): string {
	if (km2 < 0.01) {
		return `${(km2 * 1_000_000).toFixed(0)} m²`
	}
	if (km2 < 1) {
		return `${(km2 * 1_000_000).toFixed(0)} m²`
	}
	if (km2 < 100) {
		return `${km2.toFixed(2)} km²`
	}
	return `${km2.toFixed(1)} km²`
}

export function interpolateLine(points: GeoPoint[], N: number): { lon: number; lat: number; distKm: number }[] {
	if (points.length < 2) return []

	const cumDist: number[] = [0]
	for (let i = 1; i < points.length; i++) {
		cumDist.push(cumDist[i - 1] + haversineKm(points[i - 1], points[i]))
	}
	const total = cumDist[cumDist.length - 1]
	if (total === 0 || N <= 1) return points.map((p, i) => ({ ...p, distKm: cumDist[i] }))

	const result: { lon: number; lat: number; distKm: number }[] = []
	const step = total / (N - 1)

	let currentSeg = 0
	for (let i = 0; i < N; i++) {
		const targetDist = i * step
		if (i === N - 1) {
			result.push({ ...points[points.length - 1], distKm: total })
			continue
		}

		while (currentSeg < cumDist.length - 2 && cumDist[currentSeg + 1] < targetDist) {
			currentSeg++
		}

		const segStart = cumDist[currentSeg]
		const segEnd = cumDist[currentSeg + 1]
		const p1 = points[currentSeg]
		const p2 = points[currentSeg + 1]

		let t = 0
		if (segEnd > segStart) {
			t = (targetDist - segStart) / (segEnd - segStart)
		}

		result.push({
			lon: p1.lon + t * (p2.lon - p1.lon),
			lat: p1.lat + t * (p2.lat - p1.lat),
			distKm: targetDist,
		})
	}
	return result
}
