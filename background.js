// capture requests with onBeforeRequest listener
// - create or get contextualIdentities for the site
// - sites that are free stay in the current container
// - open url in a tab with the contextualIdentities

const state = {
  newTabs: new Set(),
  siteContainers: new Map(),           // csid -> name
  // unused containers stay for one gc cycle
  unusedContainers: new Set(),         // csid of unused ephemeral containers
	nextIndex: 0,
}

function isFreeHost(host) {
  for (let x of config.freeHosts) {
    if (x === host) {
      return true
    }
  }
  return false
}

async function handleRequest(arg) {
  if (config.disabled || arg.frameId !== 0 || arg.tabId === -1) {
    return {}
  }

  let tab = await browser.tabs.get(arg.tabId)
  // possibly change container for new tab only and at most once
  let isNew = state.newTabs.has(tab.id)
  //console.log(`tab:${tab.id} csid:${tab.cookieStoreId} ${isNew ? "new" : ""} url:${tab.url} arg:${arg.url}`)
  state.newTabs.delete(tab.id)
  let host = parseHost(arg.url)

  if (await toStay(tab, host, isNew, isRedirUrl(arg.url))) {
    return {}
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
        url: arg.url,
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

async function toStay(tab, host, isNew, isRedir) {
  // rules,
  // - new tab opened by another tab
  //    - (a) cookieStoreId is default: stay (user open tab in default)
  //    - cookieStoreId is not default
  //        - same as opener's cookieStoreId (e.g. middle click or link opens in new tab)
  //            - (b) same host: stay
  //            - (i) different host: use host identity
	//            - (j) redir: use host identity
  //        - (c) different cookieStoreId: stay (user open tab in this container)
  // - new tab not opened by another tab
  //    - (d) cookieStoreId is default: use host identity (new tab)
  //    - (e) not default: stay (link in page)
  // - (f) old tab in default: use host identity (free host)
  // - (g) old tab not in default: stay
  // - (h) free host: stay

  if (!isRedir && isFreeHost(host)) {
    // case (h)
    console.log(`tab:${tab.id} case h`)
    return true
  }

  if (!isNew) {
    if (tab.cookieStoreId === "firefox-default") {
      // case (f)
      console.log(`tab:${tab.id} case f`)
      return false
    } else {
      // case (g)
      console.log(`tab:${tab.id} case g`)
      return true
    }
  }

  if (tab.openerTabId) {
    if (tab.cookieStoreId === "firefox-default") {
      // case (a)
      console.log(`tab:${tab.id} case a`)
      return true
    }
    try {
      let opener = await browser.tabs.get(tab.openerTabId)
      if (opener.cookieStoreId !== tab.cookieStoreId) {
        // case (c)
        console.log(`tab:${tab.id} case c`)
        return true
      }
      if (parseHost(opener.url) === host) {
        // case (b)
        console.log(`tab:${tab.id} case b`)
        return true
      }
    } catch (e) {
    }
		if (isRedir) {
			console.log(`tab:${tab.id} case j`)
			return false
		}
    // case (i)
    console.log(`tab:${tab.id} case i`)
    return false
  }

  if (tab.cookieStoreId !== "firefox-default") {
    // case (e)
    console.log(`tab:${tab.id} case e`)
    return true
  }
  // case (d)
  console.log(`tab:${tab.id} case d`)
  return false
}

function parseHost(url) {
  let a = document.createElement("a")
  a.href = url
  return a.host
}

function matchHost(a, b) {
  return a === b || a.endsWith("."+b) || b.endsWith("."+a)
}

function isRedirUrl(url) {
	let s = url.replace(config.protocolRe, "").toLowerCase()
	for (let x of config.redirPrefixes) {
		if (s.startsWith(x)) {
			return true
		}
	}
	return false
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
  let ident = await browser.contextualIdentities.create({
    name: name,
    color: isRand ? randColor() : config.siteColor,
    icon: isRand ? config.ephemeralIcon : config.siteIcon})
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

function addTab(id) {
  //console.log(`add newtab:${id}`)
  state.newTabs.add(id)
}

function removeTab(id) {
  //console.log(`remove tab:${id}`)
  state.newTabs.delete(id)
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

async function init() {
  await initSiteContainers()

  browser.tabs.onCreated.addListener(tab => addTab(tab.id))
  // extension is not executed on all tabs, e.g. addons.mozilla.org.
  // need to clean these tab ids from newTabs
  browser.tabs.onRemoved.addListener(removeTab)

  browser.webRequest.onBeforeRequest.addListener(
    handleRequest,
    {urls: ["<all_urls>"], types: ["main_frame"]},
    ["blocking"])

  setInterval(gcEphemeralContainers, config.gcInterval)
}

init()
