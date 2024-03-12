// Confiner put a new tab to a container, ephemeral or confined.
// If the url matches a confined container, it is opened in the confined container;
// otherwise it is opened in an ephemeral container.
// A popup stays in the container it originates from, so that the login redirection works.
// All tabs are in containers.
// Unused ephemeral containers are deleted after 1h.

const config = {
	randColors: ["turquoise", "green", "yellow", "orange", "red", "pink", "purple"],
	ephemeralIcon: "chill",
	siteIcon: "fingerprint",
	siteColor: "blue",
	defaultContainer: "firefox-default",

	gcInterval: 3600*1000, 				// keep unused ephemeral containers for 1h in case closed tab is undone
	maxIndex: 36*36-1,
	disabled: false,
}

const state = {
	siteContainers: new Map(),           // csid -> name
	// unused containers stay for one gc cycle
	unusedContainers: new Set(),         // csid of unused ephemeral containers
	nextIndex: 0,
}

async function handleRequest(arg) {
	if (config.disabled || arg.frameId !== 0 || arg.tabId === -1) {
		return {}
	}

	let tab = await browser.tabs.get(arg.tabId)
	//console.log(`tab:${tab.id} csid:${tab.cookieStoreId} url:${tab.url} arg:${arg.url}`)

	// if the tab is already in a container, do nothing.
	if (tab.cookieStoreId !== config.defaultContainer) {
		return {}
	}

	try {
		let host = parseHost(arg.url)
		let csid = await getOrCreateContainer(host)
		await browser.tabs.create(
			{
				url: arg.url,
				cookieStoreId: csid,
				openerTabId: tab.id,
				index: tab.index + 1,
				active: true
			}
		)
		// close the old tab
		await browser.tabs.remove(tab.id)
		return {cancel: true}
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

function randColor() {
	let i = state.nextIndex % config.randColors.length;
	return config.randColors[i]
}

async function getOrCreateContainer(host) {
	let name = host+"·"
	for (let x of state.siteContainers) {
		if (matchHost(x[1], name)) {
			if (name.length < x[1].length) {
				// use shorter name
				await browser.contextualIdentities.update(x[0], {name: name})
			}
			return x[0]
		}
	}

	name = randName()
	let csid = await newContainer(name)
	console.log(`assign ${host} => ${name},${csid}`)
	return csid
}

async function newContainer(name) {
	let isRand = name.endsWith("~")
	let ident = await browser.contextualIdentities.create(
		{
			name: name,
			color: isRand ? randColor() : config.siteColor,
			icon: isRand ? config.ephemeralIcon : config.siteIcon
		}
	)
	return ident.cookieStoreId
}

async function initSiteContainers() {
	let m = new Map()
	let all = await browser.contextualIdentities.query({})
	for (let x of all) {
		if (x.name.endsWith("·")) {
			m.set(x.cookieStoreId, x.name)
		}
	}
	state.siteContainers = m
}

function randName() {
	// return Math.random().toString(36).substring(2, 10) + "~"
	let i = state.nextIndex
	state.nextIndex = (state.nextIndex + 1) % config.maxIndex
	return "e"+i.toString(36)+"~"
}

function isConfined(csid) {
	return state.siteContainers.has(csid)
}

function toEphemeral(csid) {
	let name = randName()
	let color = randColor()
	let icon = config.ephemeralIcon
	console.log(`convert ${csid} to ${name}`)
	state.siteContainers.delete(csid)
	let arg = {name: name, color: color, icon: icon}
	return browser.contextualIdentities.update(csid, arg)
}

function toConfined(csid, name) {
	name += "·"
	console.log(`convert ${csid} to ${name}`)
	state.siteContainers.set(csid, name)
	let arg = {name: name, color: config.siteColor, icon: config.siteIcon}
	return browser.contextualIdentities.update(csid, arg)
}

async function gcEphemeralContainers() {
	let unused = new Set()
	let all = await browser.contextualIdentities.query({})
	for (let x of all) {
		if (x.name.endsWith("~")) {
			unused.add(x.cookieStoreId)
		}
	}

	let tabs = await browser.tabs.query({})
	for (let t of tabs) {
		unused.delete(t.cookieStoreId)
	}

	let dead = []
	for (let x of state.unusedContainers) {
		if (unused.has(x)) {
			dead.push(x)
			unused.delete(x)
		}
	}
	if (dead.length > 0) {
		console.log(`remove ${dead.length} dead csids`)
		await Promise.all(dead.map(x => browser.contextualIdentities.remove(x)))
	}
	state.unusedContainers = unused
}

function handleMenu(info, tab) {
	switch (info.menuItemId) {
	case "open-link":
		browser.tabs.create(
			{
				url: info.linkUrl,
				cookieStoreId: config.defaultContainer,
				openerTabId: tab.id,
				index: tab.index + 1,
				active: true
			}
		)
		break
	}
}

async function init() {
	await initSiteContainers()

	browser.webRequest.onBeforeRequest.addListener(
		handleRequest,
		{urls: ["<all_urls>"], types: ["main_frame"]},
		["blocking"]
	)

	browser.contextMenus.create({id: "open-link", title: "Open Link in New Tab", contexts: ["link"]})
	browser.contextMenus.onClicked.addListener(handleMenu)

	setInterval(gcEphemeralContainers, config.gcInterval)
}

init()
