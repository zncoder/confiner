// Confiner put a new tab to a container, ephemeral or confined.
// If the url matches a confined container, it is opened in the confined container;
// otherwise it is opened in an ephemeral container.
// A popup stays in the container it originates from, so that the login redirection works.
// All tabs are in containers.
// Unused ephemeral containers are deleted after 1h.

const config = {
	randColors: ["green", "yellow", "orange", "red", "pink", "purple"],
	ephemeralIcon: "chill",
	siteIcon: "fingerprint",
	siteColor: "blue",
	urlIcon: "fence",
	urlColor: "turquoise",
	defaultContainer: "firefox-default",

	gcInterval: 3600*1000, // keep unused ephemeral containers for 1h in case closed tab is undone
	maxIndex: 36*36-1,
	disabled: false,
}

const state = {
	hostSuffixContainers: {}, // hostSuffix: {csid:, name:}
	urlPrefixContainers: {}, // urlPrefix: {csid:, name:}
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
		let csid = await getOrCreateContainer(arg.url)
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

function nameInUse(name) {
	name = '·' + name
	for (const [k, v] of Object.entries(state.urlPrefixContainers)) {
		if (v.name === name) {
			return true
		}
	}
	return false
}

function csidInUse(csid) {
	for (const [k, v] of Object.entries(state.hostSuffixContainers)) {
		if (v.csid === csid) {
			return true
		}
	}
	for (const [k, v] of Object.entries(state.urlPrefixContainers)) {
		if (v.csid === csid) {
			return true
		}
	}
	return false
}

function getUrlPrefixNames() {
	let names = {}
	for (const [k, v] of Object.entries(state.urlPrefixContainers)) {
		names[v.name.substring(1)] = v.csid
	}
	return names
}

function matchHost(a, b) {
	return a === b || a.endsWith("."+b) || b.endsWith("."+a)
}

function matchHostSuffix(suffix, host) {
	if (suffix === host) {
		return true
	}
	if (!suffix.startsWith('.')) {
		suffix = '.' + suffix
	}
	return host.endsWith(suffix)
}

function matchUrlPrefix(prefix, url) {
	return prefix === url || url.startsWith(prefix+'/')
}

function randColor() {
	let i = state.nextIndex % config.randColors.length;
	return config.randColors[i]
}

async function getOrCreateContainer(url) {
	let u = new URL(url)
	url = `${u.protocol}//${u.host}${u.pathname}`
	// named
	for (const [k, v] of Object.entries(state.hostSuffixContainers)) {
		if (matchHostSuffix(k, u.host)) {
			return v.csid
		}
	}
	for (const [k, v] of Object.entries(state.urlPrefixContainers)) {
		if (matchUrlPrefix(k, url)) {
			return v.csid
		}
	}

	// ephemeral
	name = randName()
	let csid = await newContainer(name)
	console.log(`assign ${u.host} => ${name},${csid}`)
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
	await loadSaved()

	let changed = false
	let all = await browser.contextualIdentities.query({})
	for (let x of all) {
		if (x.name.endsWith("·")) {
			let hostSuffix = x.name.substring(0, x.name.length-1)
			if (!state.hostSuffixContainers[hostSuffix]) {
				state.hostSuffixContainers[hostSuffix] = {csid: x.cookieStoreId, name: x.name}
				changed = true
			}
		}
	}

	if (changed) {
		await setSaved()
	}
}

function randName() {
	// return Math.random().toString(36).substring(2, 10) + "~"
	let i = state.nextIndex
	state.nextIndex = (state.nextIndex + 1) % config.maxIndex
	return "e"+i.toString(36)+"~"
}

function isConfined(csid, url) {
	for (const [k, v] of Object.entries(state.hostSuffixContainers)) {
		if (v.csid === csid) {
			return true
		}
	}
	// check url instead of csid because multiple urls may share the same container
	for (const [k, v] of Object.entries(state.urlPrefixContainers)) {
		if (matchUrlPrefix(k, url)) {
			return true
		}
	}
	return false
}

async function loadSaved() {
	let saved = await browser.storage.local.get(
		['confinerHostSuffixContainers', 'confinerUrlPrefixContainers'])
	if (saved.confinerHostSuffixContainers) {
		state.hostSuffixContainers = saved.confinerHostSuffixContainers
	}
	if (saved.confinerUrlPrefixContainers) {
		state.urlPrefixContainers = saved.confinerUrlPrefixContainers
	}
}

async function setSaved() {
	let confinerHostSuffixContainers = state.hostSuffixContainers
	let confinerUrlPrefixContainers = state.urlPrefixContainers
	await browser.storage.local.set({confinerHostSuffixContainers, confinerUrlPrefixContainers})
}

// when multiple pages share the same container because of urlPrefix,
// converting a page to ephemeral won't remove the page from
// the container until the page is opened in a new tab.
async function toEphemeral(csid, url) {
	let hostsToDel = []
	for (const [k, v] of Object.entries(state.hostSuffixContainers)) {
		if (v.csid === csid) {
			hostsToDel.push(k)
		}
	}
	for (const k of hostsToDel) {
		delete state.hostSuffixContainers[k]
	}
	let u = new URL(url)
	url = `${u.protocol}//${u.host}${u.pathname}`
	let urlsToDel = []
	for (const [k, v] of Object.entries(state.urlPrefixContainers)) {
		if (matchUrlPrefix(k, url)) {
			urlsToDel.push(k)
		}
	}
	for (const k of urlsToDel) {
		delete state.urlPrefixContainers[k]
	}
	if (hostsToDel.length > 0 || urlsToDel.length > 0) {
		await setSaved()
	}

	if (!csidInUse(csid)) {
		let name = randName()
		let color = randColor()
		let icon = config.ephemeralIcon
		let arg = {name: name, color: color, icon: icon}
		await browser.contextualIdentities.update(csid, arg)
	}
}

async function toConfined(arg) {
	let csid = arg.csid
	let hostSuffix = arg.hostSuffix
	let urlPrefix = arg.urlPrefix
	if (hostSuffix) {
		let name = hostSuffix + "·"
		console.log(`convert ${csid} to ${name}`)
		await browser.contextualIdentities.update(
			csid,
			{name: name, color: config.siteColor, icon: config.siteIcon}
		)

		state.hostSuffixContainers[hostSuffix] = {csid: csid, name: name}
	} else if (urlPrefix) {
		let name = '·' + arg.name
		console.log(`convert ${csid} to ${name}`)
		await browser.contextualIdentities.update(
			csid,
			{name: name, color: config.urlColor, icon: config.urlIcon}
		)

		state.urlPrefixContainers[urlPrefix] = {csid: csid, name: name}
	}
	await setSaved()
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
