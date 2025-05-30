"use client"

import { useEffect, useRef } from "react"

export function AnimatedBackground() {
	const canvasRef = useRef<HTMLCanvasElement>(null)

	useEffect(() => {
		const canvas = canvasRef.current
		if (!canvas) return

		const ctx = canvas.getContext("2d")
		if (!ctx) return

		// grid settings
		const gridSize = 50
		const gridOpacity = 0.15

		// initialize gradient points for lighting effects
		let gradientPoints = [
			{
				x: canvas.width * 0.2,
				y: canvas.height * 0.3,
				radius: canvas.width * 0.4,
				color: "rgba(0, 100, 255, 0.15)",
			},
			{
				x: canvas.width * 0.8,
				y: canvas.height * 0.7,
				radius: canvas.width * 0.5,
				color: "rgba(100, 0, 255, 0.1)",
			},
		]

		// particle system
		const particles: Particle[] = []
		const particleCount = Math.min(50, Math.floor(window.innerWidth / 40))

		// set canvas dimensions
		const resizeCanvas = () => {
			canvas.width = window.innerWidth
			canvas.height = window.innerHeight

			// update gradient points when canvas is resized
			gradientPoints = [
				{
					x: canvas.width * 0.2,
					y: canvas.height * 0.3,
					radius: canvas.width * 0.4,
					color: "rgba(0, 100, 255, 0.15)",
				},
				{
					x: canvas.width * 0.8,
					y: canvas.height * 0.7,
					radius: canvas.width * 0.5,
					color: "rgba(100, 0, 255, 0.1)",
				},
			]

			// redraw grid after resize
			drawGrid()
		}

		resizeCanvas()
		window.addEventListener("resize", resizeCanvas)

		// draw grid with perspective effect
		function drawGrid() {
			if (!ctx) {
				throw new Error("Context is null (not initialized?)")
			}

			if (!canvas) {
				throw new Error("Canvas is null (not initialized?)")
			}

			ctx.clearRect(0, 0, canvas.width, canvas.height)

			// Draw gradient lighting effects.
			gradientPoints.forEach((point) => {
				const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, point.radius)
				gradient.addColorStop(0, point.color)
				gradient.addColorStop(1, "rgba(0, 0, 0, 0)")

				ctx.fillStyle = gradient
				ctx.fillRect(0, 0, canvas.width, canvas.height)
			})

			// Draw grid lines with perspective effect.
			ctx.strokeStyle = `rgba(50, 50, 70, ${gridOpacity})`
			ctx.lineWidth = 0.5

			// horizontal lines with perspective.
			const horizonY = canvas.height * 0.7 // Horizon point.
			const vanishingPointX = canvas.width * 0.5 // Center vanishing point.

			// Vertical lines.
			for (let x = 0; x <= canvas.width; x += gridSize) {
				const normalizedX = x / canvas.width - 0.5 // -0.5 to 0.5

				ctx.beginPath()
				ctx.moveTo(x, 0)

				// Calculate curve based on distance from center.
				const curveStrength = 50 * Math.abs(normalizedX)
				const controlPointY = horizonY - curveStrength

				// Create curved line toward vanishing point.
				ctx.quadraticCurveTo(
					x + (vanishingPointX - x) * 0.3,
					controlPointY,
					vanishingPointX + (x - vanishingPointX) * 0.2,
					horizonY,
				)

				ctx.stroke()
			}

			// Horizontal lines.
			for (let y = 0; y <= horizonY; y += gridSize) {
				const normalizedY = y / horizonY // 0 to 1
				const lineWidth = gridSize * (1 + normalizedY * 5) // lines get wider as they get closer

				ctx.beginPath()
				ctx.moveTo(vanishingPointX - lineWidth, y)
				ctx.lineTo(vanishingPointX + lineWidth, y)
				ctx.stroke()
			}

			updateParticles()
		}

		class Particle {
			x: number
			y: number
			size: number
			speedX: number
			speedY: number
			color: string
			opacity: number

			constructor() {
				if (!canvas) {
					throw new Error("Canvas is null (not initialized?)")
				}

				this.x = Math.random() * canvas.width
				this.y = Math.random() * (canvas.height * 0.7) // Keep particles above horizon.
				this.size = Math.random() * 2 + 1
				this.speedX = (Math.random() - 0.5) * 0.8
				this.speedY = (Math.random() - 0.5) * 0.8
				this.color = "rgba(100, 150, 255, "
				this.opacity = Math.random() * 0.5 + 0.2
			}

			update() {
				if (!canvas) {
					throw new Error("Canvas is null (not initialized?)")
				}

				this.x += this.speedX
				this.y += this.speedY

				// Boundary check.
				if (this.x > canvas.width) this.x = 0
				else if (this.x < 0) this.x = canvas.width
				if (this.y > canvas.height * 0.7) this.y = 0
				else if (this.y < 0) this.y = canvas.height * 0.7

				// Pulsate opacity.
				this.opacity += Math.sin(Date.now() * 0.001) * 0.01
				this.opacity = Math.max(0.1, Math.min(0.7, this.opacity))
			}

			draw() {
				if (!ctx) {
					throw new Error("Context is null (not initialized?)")
				}

				ctx.fillStyle = `${this.color}${this.opacity})`
				ctx.beginPath()
				ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2)
				ctx.fill()
			}
		}

		// Initialize particles.
		for (let i = 0; i < particleCount; i++) {
			particles.push(new Particle())
		}

		// Connect particles with lines.
		function connectParticles() {
			if (!ctx) {
				throw new Error("Context is null (not initialized?)")
			}

			const maxDistance = 150

			for (let a = 0; a < particles.length; a++) {
				for (let b = a; b < particles.length; b++) {
					const dx = particles[a]!.x - particles[b]!.x
					const dy = particles[a]!.y - particles[b]!.y
					const distance = Math.sqrt(dx * dx + dy * dy)

					if (distance < maxDistance) {
						const opacity = (1 - distance / maxDistance) * 0.5
						ctx.strokeStyle = `rgba(100, 150, 255, ${opacity})`
						ctx.lineWidth = 0.5
						ctx.beginPath()
						ctx.moveTo(particles[a]!.x, particles[a]!.y)
						ctx.lineTo(particles[b]!.x, particles[b]!.y)
						ctx.stroke()
					}
				}
			}
		}

		function updateParticles() {
			particles.forEach((particle) => {
				particle.update()
				particle.draw()
			})

			connectParticles()
		}

		// Animation loop.
		let animationId: number

		// Target position for smooth following.
		let targetX = canvas.width * 0.2
		let targetY = canvas.height * 0.3
		const moveSpeed = 0.05 // Adjust this value to control movement speed (0-1).

		// Move gradient points with mouse.
		const handleMouseMove = (e: MouseEvent) => {
			targetX = e.clientX
			targetY = e.clientY
		}

		// Update gradient point position in animation loop.
		function updateGradientPosition() {
			if (!canvas) throw new Error("Canvas is null (not initialized?)")

			// Calculate direction vector.
			const dx = targetX - gradientPoints[0]!.x
			const dy = targetY - gradientPoints[0]!.y

			// Smooth movement using linear interpolation.
			gradientPoints[0]!.x += dx * moveSpeed
			gradientPoints[0]!.y += dy * moveSpeed

			// Adjust radius based on distance to target.
			const distanceToTarget = Math.sqrt(dx * dx + dy * dy)
			gradientPoints[0]!.radius = Math.max(
				canvas.width * 0.2,
				Math.min(canvas.width * 0.4, canvas.width * 0.3 + distanceToTarget * 0.1),
			)
		}

		function animate() {
			animationId = requestAnimationFrame(animate)
			updateGradientPosition()
			drawGrid()
		}

		animate()

		window.addEventListener("mousemove", handleMouseMove)

		return () => {
			window.removeEventListener("resize", resizeCanvas)
			window.removeEventListener("mousemove", handleMouseMove)
			cancelAnimationFrame(animationId)
		}
	}, [])

	return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" style={{ zIndex: 0 }} />
}
