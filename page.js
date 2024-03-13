async function initPage() {
	let [tab] = await browser.tabs.query({active: true, currentWindow: true})
	let csid = tab.cookieStoreId
	let url = tab.url
	console.log(`page for csid:${csid} url:${url}`)
	if (csid === "firefox-default") {
		hideBody()
		return
	}

	let bg = await browser.runtime.getBackgroundPage()

	let toRand = bg.isConfined(csid)
	if (toRand) {
		enableEphemeral(bg, csid)
	} else {
		enableConfined(bg, csid, url)
	}
}

function sel(x) {
	return document.querySelector(x)
}

function hideBody() {
	sel("#body_sec").style.display = "none"
	sel("#note_sec").innerText = "Cannot toggle default container"
}

function enableEphemeral(bg, csid) {
	sel('#to_confined_btn').style.display = 'none'
	sel('#to_ephemeral_btn').style.display = 'block'
	let btn = sel("#to_ephemeral_btn")
	btn.addEventListener("click", () => {
		bg.toEphemeral(csid)
		window.close()
	})
	sel('#confined_sec').style.display = 'none'
}

async function onHostBtnClicked() {
	let [tab] = await browser.tabs.query({active: true, currentWindow: true})
	let url = new URL(tab.url)
	sel('#pattern_btn').value = url.host
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
	console.log('pat.value', pat.value)
}

async function onUrlBtnClicked() {
	let [tab] = await browser.tabs.query({active: true, currentWindow: true})
	let url = new URL(tab.url)
	let path = url.pathname
	if (path.endsWith('/')) {
		path = path.substring(0, path.length-1)
	}
	sel('#pattern_btn').value = path
}

async function enableConfined(bg, csid, url) {
	sel('#to_confined_btn').style.display = 'block'
	sel('#to_ephemeral_btn').style.display = 'none'
	sel("#to_confined_btn").addEventListener("click", () => {
		let name = sel('#pattern_btn').value
		bg.toConfined(csid, name)
		window.close()
	})

	sel('#host_btn').addEventListener('change', onHostBtnClicked)
	sel('#url_btn').addEventListener('change', onUrlBtnClicked)
	sel('#minus_btn').addEventListener('click', () => onMinusBtnClicked(url))

	await onHostBtnClicked()
}

initPage()
