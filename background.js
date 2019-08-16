// capture requests with onBeforeRequest listener
// - create or get contextualIdentities for the site
// - sites that are free stay in the current container
// - open url in a tab with the contextualIdentities

const confiner = {
	disabled: false,
	newTabs: new Set(),
	allContainers: [],					 // [[name, csid]], don't allow dup name

	isFreeHost(host) {
		for (let x of freeHosts) {
			if (x === host) {
				return true
			}
		}
		return false
	},

	async handleRequest(arg) {
		if (this.disabled || arg.frameId !== 0 || arg.tabId === -1) {
			return {}
		}

		let tab = await browser.tabs.get(arg.tabId)
		console.log(`tab:${tab.id} url:${tab.url} arg:${arg.url}`)
		// possibly change container for new tab only and at most once
		let isNew = this.newTabs.has(tab.id)
		this.deleteNewTab(tab.id)
		let host = this.parseHost(arg.url)

		if (await this.toStay(tab, host, isNew)) {
			return {}
		}

		// get or create container
		try {
			let csid = await this.getOrCreateContainer(host)
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
	},

	async toStay(tab, host, isNew) {
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
		// - (h) free host: stay

		if (this.isFreeHost(host)) {
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
			} catch (e) {
			}
			// case (b)
			console.log(`tab:${tab.id} case b`)
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
	},

	parseHost(url) {
		let a = document.createElement("a")
		a.href = url
		return a.host
	},

	matchHost(a, b) {
		return a === b || a.endsWith("."+b) || b.endsWith("."+a)
	},

	async getOrCreateContainer(host) {
		let name = `${host}·`
		for (let x of this.allContainers) {
			if (this.matchHost(x[0], name)) {
				if (name.length < x[0].length) {
					// use shorter name
					await browser.contextualIdentities.update(x[1], {name: name})
				}
				return x[1]
			}
		}

		let ident = await browser.contextualIdentities.create({
			name: name,
			color: "blue",
			icon: "fingerprint"})
		console.log(`add ${ident.name} => ${ident.cookieStoreId}`)
		this.allContainers.push([ident.name, ident.cookieStoreId])
		return ident.cookieStoreId
	},

	async initAllContainers() {
		let idents = []
		let all = await browser.contextualIdentities.query({})
		for (let x of all) {
			if (x.name.endsWith("·")) {
				idents.push([x.name, x.cookieStoreId])
			}
		}
		this.allContainers = idents
	},

	addNewTab(id) {
		//console.log(`add newtab:${id}`)
		this.newTabs.add(id)
	},

	deleteNewTab(id) {
		//console.log(`delete newtab:${id}`)
		this.newTabs.delete(id)
	},

	async init() {
		await this.initAllContainers()

		browser.tabs.onCreated.addListener(tab => this.addNewTab(tab.id))
		// extension is not executed on all tabs, e.g. addons.mozilla.org.
		// need to clean these tab ids from newTabs
		browser.tabs.onRemoved.addListener(id => this.deleteNewTab(id))
		
		browser.webRequest.onBeforeRequest.addListener(
			// need to use this closure as the callback, not this.handleRequest,
			// to make this works.
			arg => { return this.handleRequest(arg) },
			{urls: ["<all_urls>"], types: ["main_frame"]},
			["blocking"])
	},
}

confiner.init()
