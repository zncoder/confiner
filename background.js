// capture requests with onBeforeRequest listener
// - create or get contextualIdentities for the site
// - sites that are free stay in the current container
// - open url in a tab with the contextualIdentities

let disabled

browser.webRequest.onBeforeRequest.addListener(
	handleRequest,
	{urls: ["<all_urls>"], types: ["main_frame"]},
	["blocking"])

let newTabs = new Set()
let allContainers = [] 								// [[name, csid]], don't allow dup name

function isFreeHost(host) {
	for (let x of freeHosts) {
		if (x === host) {
			return true
		}
	}
	return false
}

async function handleRequest(args) {
	if (disabled || args.frameId !== 0 || args.tabId === -1) {
		return {}
	}

	let host = parseHost(args.url)
	if (isFreeHost(host)) {
		deleteNewTab(args.tabId)
		return {}
	}

	// rules,
	// - new tab opened by another tab
	//    - (a) cookieStoreId is default: stay (user open tab in default)
	//    - cookieStoreId is not default
	//        - (b) same as opener's cookieStoreId: use host identity (e.g. middle click)
	//        - (c) different cookieStoreId: stay (user open tab in this container)
	// - new tab not opened by another tab
	//    - (d) cookieStoreId is default: use host identity (new tab)
	//    - (e) not default: stay (link in page)
	// - (f) old tab in default: use host identity (free host)
	// - (g) old tab not in default: stay

	let tab = await browser.tabs.get(args.tabId)
	//console.log(`tab:${tab.id} url:${tab.url} arg:${args.url}`)
	// possibly change container for new tab only and at most once
	let isNew = newTabs.has(tab.id)
	deleteNewTab(tab.id)
	
	if (!isNew) {
		if (tab.cookieStoreId === "firefox-default") {
			// case (f)
			console.log(`tab:${tab.id} case f`)
		} else {
			// case (g)
			console.log(`tab:${tab.id} case g`)
			return {}
		}
	} else if (tab.openerTabId) {
		if (tab.cookieStoreId === "firefox-default") {
			// case (a)
			console.log(`tab:${tab.id} case a`)
			return {}
		}
		try {
			let opener = await browser.tabs.get(tab.openerTabId)
			if (opener.cookieStoreId !== tab.cookieStoreId) {
				// case (c)
				console.log(`tab:${tab.id} case c`)
				return {}
			}
		} catch (e) {
		}
		// case (b)
		console.log(`tab:${tab.id} case b`)
	} else {
		if (tab.cookieStoreId !== "firefox-default") {
			// case (e)
			console.log(`tab:${tab.id} case e`)
			return {}
		}
		// case (d)
		console.log(`tab:${tab.id} case d`)
	}

	// get or create container
	try {
		let csid = await getOrCreateContainer(host)
		if (tab.cookieStoreId !== csid) {
			// await so that tab is removed only if new tab is created successfully.
			// in case container is disabled
			let index = tab.index
			if (!isNew) {
				index++
			}
			await browser.tabs.create({
				url: args.url,
				cookieStoreId: csid,
				openerTabId: tab.id,
				index: index,
				active: true})
			if (isNew) {
				browser.tabs.remove(tab.id)
			}
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

function matchHost(a, b) {
	return a === b || a.endsWith("."+b) || b.endsWith("."+a)
}

async function getOrCreateContainer(host) {
	let name = `${host}·`
	for (let x of allContainers) {
		if (matchHost(x[0], name)) {
			return x[1]
		}
	}

	let ident = await browser.contextualIdentities.create({
		name: name,
		color: "blue",
		icon: "fingerprint"})
	console.log(`add ${ident.name} => ${ident.cookieStoreId}`)
	allContainers.push([ident.name, ident.cookieStoreId])
	return ident.cookieStoreId
}

async function initAllContainers() {
	let idents = []
	let all = await browser.contextualIdentities.query({})
	for (let x of all) {
		if (x.name.endsWith("·")) {
			idents.push([x.name, x.cookieStoreId])
		}
	}
	allContainers = idents
}

function addNewTab(id) {
	//console.log(`add newtab:${id}`)
	newTabs.add(id)
}

function deleteNewTab(id) {
	//console.log(`delete newtab:${id}`)
	newTabs.delete(id)
}

async function init() {
	await initAllContainers()

	browser.tabs.onCreated.addListener(tab => addNewTab(tab.id))
	// extension is not executed on all tabs, e.g. addons.mozilla.org.
	// need to clean these tab ids from newTabs
	browser.tabs.onRemoved.addListener(id => deleteNewTab(id))
}
init()
