// capture requests with onBeforeRequest listener
// - create or get contextualIdentities for the site
// - sites that are exempted stay in the current container
// - open url in a tab with the contextualIdentities

// reset the cookieStoreId if openerTabId is set

let disabled

browser.webRequest.onBeforeRequest.addListener(
	handleRequest,
	{urls: ["<all_urls>"], types: ["main_frame"]},
	["blocking"])

let newTabs = new Set()

async function handleRequest(args) {
	if (disabled || args.frameId !== 0 || args.tabId === -1) {
		return {}
	}

	let tab = await browser.tabs.get(args.tabId)
	// possibly change container for new tab only and at most once
	if (!newTabs.has(tab.id)) {
		return {}
	}
	newTabs.delete(tab.id)
	
	// rules,
	// - new tab opened by another tab
	//    - (a) cookieStoreId is default: stay (user open tab in default)
	//    - cookieStoreId is not default
	//        - (b) same as opener's cookieStoreId: use host identity (e.g. middle click)
	//        - (c) different cookieStoreId: stay (user open tab in this container)
	// - new tab not opened by another tab
	//    - (d) cookieStoreId is default: use host identity (new tab)
	//    - (e) not default: stay (link in page)
	if (tab.openerTabId) {
		if (tab.cookieStoreId === "firefox-default") {
			// case (a)
			return {}
		}
		try {
			let opener = await browser.tabs.get(tab.openerTabId)
			if (opener.cookieStoreId !== tab.cookieStoreId) {
				// case (c)
				return {}
			}
		} catch (e) {
		}
		// case (b)
	} else {
		if (tab.cookieStoreId !== "firefox-default") {
			// case (e)
			return {}
		}
		// case (d)
	}

	// get or create identity
	let host = parseHost(args.url)
	try {
		let csid = await getOrCreateIdentity(host)
		if (tab.cookieStoreId !== csid) {
			// await so that tab is removed only if new tab is created successfully.
			// in case container is disabled
			await browser.tabs.create({
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
	browser.tabs.onCreated.addListener(tab => newTabs.add(tab.id))
	// extension is not executed on all tabs, e.g. addons.mozilla.org.
	// need to clean these tab ids from newTabs
	browser.tabs.onRemoved.addListener(id => newTabs.delete(id))
}
init()
