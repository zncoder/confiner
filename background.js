// capture requests with onBeforeRequest listener
// - create contextualIdentities for the site if not yet
// - sites that are exempted stay in default container
// - open url in a tab with the contextualIdentities
//
// frameId is 0
// originalUrl is set if it is a link click or moz-extension 
// tabId not -1
// url
//
// tab.cookieStoreId

let disabled

browser.webRequest.onBeforeRequest.addListener(
	handleRequest,
	{urls: ["<all_urls>"], types: ["main_frame"]},
	["blocking"])

async function handleRequest(args) {
	if (args.frameId !== 0 || args.tabId === -1 || disabled) {
		return {}
	}
	// get or create identity
	let host = parseHost(args.url)
	try {
		let csid = await getOrCreateIdentity(host)
		let tab = await browser.tabs.get(args.tabId)
		if (tab.cookieStoreId !== csid) {
			browser.tabs.create({
				url: args.url,
				cookieStoreId: csid,
				index: tab.index,
				active: true})
			browser.tabs.remove(tab.id)
			return {cancel: true}
		}
	} catch (e) {
		console.log(`handlerequest err:${e}`)
	}
	return {}
}

function parseHost(url) {
	let a = document.createElement("a")
	a.href = url
	return a.host
}

async function getOrCreateIdentity(host) {
	let arr = await browser.contextualIdentities.query({name: host})
	if (arr.length > 0) {
		return arr[0].cookieStoreId
	}

	let ident = await browser.contextualIdentities.create({name: host, color: "blue", icon: "fingerprint"})
	return ident.cookieStoreId
}
