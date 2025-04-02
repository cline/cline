const formatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
})

export const formatCurrency = (amount: number) => formatter.format(amount)
