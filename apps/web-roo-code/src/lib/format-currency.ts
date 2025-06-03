const formatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
})

export const formatCurrency = (amount: number) => formatter.format(amount)

export const parsePrice = (price?: string) => (price ? parseFloat(price) * 1_000_000 : undefined)
