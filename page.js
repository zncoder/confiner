async function initPage() {
	let [tab] = await browser.tabs.query({active: true, currentWindow: true})
	let csid = tab.cookieStoreId
	let u = new URL(tab.url)
	let url = `${u.protocol}//${u.host}${u.pathname}`
	// console.log(`page for csid:${csid} url:${url}`)
	if (csid === "firefox-default") {
		hideBody()
		return
	}

	let bg = await browser.runtime.getBackgroundPage()
	if (bg.isConfined(csid, url)) {
		enableEphemeral(bg, csid, url)
	} else {
		enableConfined(url)
	}
	enableReopen(bg)

	setNote()
}

function enableReopen(bg) {
	let sec = sel('#reopen_sec')
	let names = bg.getNames(false)
	if (Object.keys(names).length === 0) {
		sec.style.display = 'none'
	} else {
		let el = sel('#reopen_name_sel')
		buildSelectNames(el, names, true)
		el.addEventListener('change', reopenTabIn)
		sec.style.display = 'block'
	}
}

async function reopenTabIn() {
	let [name, csid] = getSelectValue(sel('#reopen_name_sel'))
	if (name === '…') {
		setNote('select a name')
		return
	}
	let [tab] = await browser.tabs.query({active: true, currentWindow: true})
	let bg = await browser.runtime.getBackgroundPage()
	if (csid === '_invalid_') {
		csid = undefined
	}
	await bg.openUrl({url: tab.url, opener: tab, closeOpener: true, csid: csid})
	window.close()
}

function setNote(msg) {
	let el = sel('#note_sec')
	if (!msg) {
		msg = el.getAttribute('data-text')
	}
	el.innerText = msg
}

function sel(x) {
	return document.querySelector(x)
}

function hideBody() {
	sel("#confined_sec").style.display = 'none'
	sel("#note_sec").innerText = "Cannot toggle default container"
}

function enableEphemeral(bg, csid, url) {
	sel('#to_confined_btn').style.display = 'none'
	sel('#to_ephemeral_btn').style.display = 'block'
	let btn = sel("#to_ephemeral_btn")
	btn.addEventListener("click", () => {
		bg.toEphemeral(csid, url)
		window.close()
	})
	sel('#confined_sec').style.display = 'none'
}

async function onHostBtnClicked() {
	let [tab] = await browser.tabs.query({active: true, currentWindow: true})
	let url = new URL(tab.url)
	sel('#pattern_btn').value = url.host
	sel('#name_sec').style.display = 'none'
}

function onMinusBtnClicked(url) {
	let pat = sel('#pattern_btn')
	if (sel('#host_btn').checked) {
		let ss = pat.value.split('.')
		if (ss.length < 3) {
			pat.value = new URL(url).host
		} else {
			pat.value = ss.slice(1).join('.')
		}
	} else {
		let i = pat.value.lastIndexOf('/')
		if (i === 0) {
			pat.value = new URL(url).pathname
		} else {
			pat.value = pat.value.substring(0, i)
		}
	}
}

async function onUrlBtnClicked() {
	let [tab] = await browser.tabs.query({active: true, currentWindow: true})
	let url = new URL(tab.url)
	let path = url.pathname
	if (path.endsWith('/')) {
		path = path.substring(0, path.length-1)
	}
	sel('#pattern_btn').value = path
	sel('#name_sec').style.display = 'block'
	let bg = await browser.runtime.getBackgroundPage()
	if (!initNameSelect(bg, true)) {
		onPlusBtnClicked()
	}
}

function initNameSelect(bg, urlsOnly) {
	let names = bg.getNames(urlsOnly)
	let sec = sel('#choose_name_sec')
	if (Object.keys(names).length === 0) {
		sec.setAttribute('data-sel', '0')
		return false
	}

	sec.style.display = 'block'
	sec.setAttribute('data-sel', '1')
	sel('#name_btn').style.display = 'none'

	buildSelectNames(sel('#choose_name_sel'), names)
	sel('#plus_btn').addEventListener('click', onPlusBtnClicked)
	return true
}

function buildSelectNames(el, names, placeholder) {
	let entries = Object.entries(names)
	if (entries.length === 0) {
		return
	}
	if (placeholder) {
		let opt = document.createElement('option')
		opt.text = '…'
		opt.value = '_invalid_'
		el.appendChild(opt)
		opt = document.createElement('option')
		opt.text = '*as new*'
		opt.value = '_invalid_'
		el.appendChild(opt)
	}
	entries.sort()
	for (const [name, csid] of entries) {
		let opt = document.createElement('option')
		opt.text = name
		opt.value = csid
		el.appendChild(opt)
	}
}

function onPlusBtnClicked() {
	let sec = sel('#choose_name_sec')
	sec.style.display = 'none'
	sec.setAttribute('data-sel', '0')
	sel('#name_btn').style.display = 'block'
	setNameBtnPlaceholder()
}

function setNameBtnPlaceholder() {
	let btn = sel('#name_btn')
	btn.placeholder = btn.getAttribute('data-text')
}

const nameRe = new RegExp('[a-z]{3,}')

async function onConfinedBtnClicked() {
	let [tab] = await browser.tabs.query({active: true, currentWindow: true})
	let bg = await browser.runtime.getBackgroundPage()
	let val = sel('#pattern_btn').value
	if (sel('#host_btn').checked) {
		bg.toConfined({hostSuffix: val, csid: tab.cookieStoreId})
	} else {
		let [name, csid] = await getNameSecValue()
		if (!name) {
			return
		}
		let u = new URL(tab.url)
		let prefix = `${u.protocol}//${u.host}${val}`
		if (!csid) {
			csid = tab.cookieStoreId
		}
		bg.toConfined({urlPrefix: prefix, csid: csid, name: name})
	}
	window.close()
}

function getSelectValue(el) {
	let opt = el.options[el.selectedIndex]
	return [opt.text, opt.value]
}

async function getNameSecValue() {
	let sec = sel('#choose_name_sec')
	if (sec.getAttribute('data-sel') === '1') {
		return getSelectValue(sel('#choose_name_sel'))
	} else {
		let name = sel('#name_btn').value
		if (!nameRe.test(name)) {
			setNote('name must be 3+ a-z chars')
			return [undefined, undefined]
		}
		let bg = await browser.runtime.getBackgroundPage()
		if (bg.urlPrefixNameInUse(name)) {
			setNote(`${name} is in use`)
			return [undefined, undefined]
		}
		return [name, undefined]
	}
}

async function enableConfined(url) {
	sel('#to_confined_btn').style.display = 'block'
	sel('#to_ephemeral_btn').style.display = 'none'
	sel("#to_confined_btn").addEventListener("click", onConfinedBtnClicked)
	sel('#host_btn').addEventListener('change', onHostBtnClicked)
	sel('#url_btn').addEventListener('change', onUrlBtnClicked)
	sel('#minus_btn').addEventListener('click', () => onMinusBtnClicked(url))

	await onHostBtnClicked()
}

initPage()
