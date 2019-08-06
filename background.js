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
	if (disabled || args.frameId !== 0 || args.tabId === -1 || args.cookieStoreId !== "firefox-default") {
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
	let name = `${host}#cfn`
	for (let k in allIdentities) {
		if (k === name || k.endsWith("."+name) || name.endsWith("."+k)) {
			return allIdentities[k]
		}
	}

	let ident = await browser.contextualIdentities.create({name: name, color: "blue", icon: "fingerprint"})
	console.log(`add ${ident.name} => ${ident.cookieStoreId}`)
	allIdentities[ident.name] = ident.cookieStoreId
	return ident.cookieStoreId
}

let allIdentities = {} 								// name => csid, don't allow dup name

async function initAllIdentities() {
	let idents = {}
	let all = await browser.contextualIdentities.query({})
	for (let x of all) {
		if (x.name.endsWith("#cfn")) {
			idents[x.name] = x.cookieStoreId
		}
	}
	allIdentities = idents
}

async function init() {
	await initAllIdentities()
}
init()
