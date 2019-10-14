const config = {
	redirPrefixes: [
		"www.google.com/url?"
	],
	protocolRe: new RegExp("^https?://"),
	
	randColors: ["turquoise", "green", "yellow", "orange", "red", "pink", "purple"],
	ephemeralIcon: "chill",
	siteIcon: "fingerprint",
	siteColor: "blue",

	gcInterval: 3600*1000, 				// keep unused ephemeral containers for 1h in case closed tab is undone
	maxIndex: 36*36-1,
	disabled: false,
}
