async function initPage() {
	let tabs = await browser.tabs.query({active: true, currentWindow: true})
  let tab = tabs[0]
  let csid = tab.cookieStoreId
  if (csid === "firefox-default") {
    hideAction()
		return
  }

	let bg = await browser.runtime.getBackgroundPage()

	let toRand = bg.isConfined(csid)
	if (toRand) {
		enableEphemeral(bg, csid)
	} else {
		enableConfined(bg, csid, tab.url)
	}
}

function sel(x) {
	return document.querySelector(x)
}

function hideAction() {
	sel("#action_sec").style.display = "none"
	sel("#note_sec").innerText = "Cannot toggle default container"
}

function enableEphemeral(bg, csid) {
	sel("#action_sec").style.display = "block"
	sel("#confined_sec").style.display = "none"
	let btn = sel("#action_btn")
	btn.value = "To ephemeral container"
	btn.addEventListener("click", () => {
		bg.toEphemeral(csid)
		window.close()
	})
}

function enableConfined(bg, csid, url) {
	sel("#action_sec").style.display = "block"
	let name = bg.parseHost(url)
	sel("#confined_sec").style.display  = "block"
	let cfn = sel("#confined_name")
	cfn.value = name

	let btn = sel("#action_btn")
	btn.value = "To confined container"
	btn.addEventListener("click", () => {
		bg.toConfined(csid, cfn.value)
		window.close()
	})

	sel("#confined_reduce").addEventListener("click", () => {
		let ss = cfn.value.split(".")
		if (ss.length < 3) {
			cfn.value = name
		} else {
			cfn.value = ss.slice(1).join(".")
		}
	})
}

initPage()
