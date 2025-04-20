document.addEventListener("DOMContentLoaded", function () {
	// Tab switching functionality
	const tabButtons = document.querySelectorAll(".tab-button")

	tabButtons.forEach((button) => {
		button.addEventListener("click", function () {
			// Remove active class from all tabs
			tabButtons.forEach((btn) => {
				btn.classList.remove("active")
			})

			// Add active class to clicked tab
			this.classList.add("active")

			// Here you would typically show/hide content based on the selected tab
			// For this demo, we're just changing the active state of the tab
		})
	})

	// Button hover effects
	const allButtons = document.querySelectorAll("button")

	allButtons.forEach((button) => {
		button.addEventListener("mouseenter", function () {
			this.style.opacity = "1"
			this.style.transform = "scale(1.02)"
			this.style.transition = "all 0.2s ease"
		})

		button.addEventListener("mouseleave", function () {
			this.style.transform = "scale(1)"

			// Only reset opacity for action buttons that have default opacity of 0.5
			if (this.classList.contains("action-button")) {
				this.style.opacity = "0.5"
			}
		})
	})

	// Feature card hover effects
	const featureCards = document.querySelectorAll(".feature-card")

	featureCards.forEach((card) => {
		card.addEventListener("mouseenter", function () {
			this.style.transform = "translateY(-5px)"
			this.style.boxShadow = "0 10px 20px rgba(0, 0, 0, 0.2)"
			this.style.transition = "all 0.3s ease"
		})

		card.addEventListener("mouseleave", function () {
			this.style.transform = "translateY(0)"
			this.style.boxShadow = "none"
		})
	})

	// Feature option hover effects
	const featureOptions = document.querySelectorAll(".feature-option")

	featureOptions.forEach((option) => {
		option.addEventListener("mouseenter", function () {
			this.style.backgroundColor = "rgba(43, 43, 43, 0.5)"
			this.style.transition = "all 0.2s ease"
		})

		option.addEventListener("mouseleave", function () {
			this.style.backgroundColor = "transparent"
		})
	})

	// Input field focus effect
	const inputField = document.querySelector(".input-field")
	const inputPlaceholder = document.querySelector(".input-placeholder")

	if (inputField && inputPlaceholder) {
		inputField.addEventListener("click", function () {
			inputPlaceholder.style.opacity = "0.7"
			inputField.style.borderColor = "#4DAAFC"

			// Create a temporary input element for demonstration
			if (!document.querySelector(".temp-input")) {
				const tempInput = document.createElement("input")
				tempInput.type = "text"
				tempInput.className = "temp-input"
				tempInput.style.width = "100%"
				tempInput.style.background = "transparent"
				tempInput.style.border = "none"
				tempInput.style.outline = "none"
				tempInput.style.color = "#FFFFFF"
				tempInput.style.fontSize = "14px"
				tempInput.style.fontFamily = "SF Pro, Inter, sans-serif"

				inputPlaceholder.style.display = "none"
				inputField.insertBefore(tempInput, inputField.firstChild)
				tempInput.focus()

				tempInput.addEventListener("blur", function () {
					if (!this.value) {
						inputPlaceholder.style.display = "block"
						inputPlaceholder.style.opacity = "1"
						this.remove()
					}
					inputField.style.borderColor = "#3C3C3C"
				})
			}
		})
	}

	// Back button hover effect
	const backButton = document.querySelector(".back-button-container")

	if (backButton) {
		backButton.addEventListener("mouseenter", function () {
			this.style.opacity = "0.8"
			this.style.cursor = "pointer"
		})

		backButton.addEventListener("mouseleave", function () {
			this.style.opacity = "1"
		})

		backButton.addEventListener("click", function () {
			// This would typically navigate back to the main Cline page
			alert("Navigating back to Cline...")
		})
	}
})
