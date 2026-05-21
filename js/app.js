const PHOTON_API = "https://photon.komoot.io/api/";
const DEBOUNCE_MS = 100;
const MIN_QUERY_LEN = 1;
const SUGGESTION_LIMIT = 10;
/** Mehr von der API holen, damit nach dem Filtern oft 10 Treffer übrig bleiben */
const PHOTON_FETCH_LIMIT = 30;
const MAX_HISTORY = 25;
const HISTORY_STORAGE_KEY = "adressinator-history";
/** Deutschland (minLon, minLat, maxLon, maxLat) */
const DE_BBOX = "5.87,47.27,15.04,55.06";

const queryInput = document.getElementById("address-query");
const suggestionsEl = document.getElementById("suggestions");
const statusEl = document.getElementById("search-status");
const streetInput = document.getElementById("street");
const plzInput = document.getElementById("plz");
const stadtInput = document.getElementById("stadt");
const resetBtn = document.getElementById("reset-btn");
const copyBtn = document.getElementById("copy-btn");
const historyListEl = document.getElementById("history-list");
const historyEmptyEl = document.getElementById("history-empty");
const clearHistoryBtn = document.getElementById("clear-history-btn");

let debounceTimer = null;
let activeIndex = -1;
let currentSuggestions = [];
let abortController = null;
let history = loadHistory();

queryInput.addEventListener("input", onInput);
queryInput.addEventListener("keydown", onKeyDown);
queryInput.addEventListener("blur", () => {
	setTimeout(hideSuggestions, 150);
});
suggestionsEl.addEventListener("mousedown", (e) => {
	e.preventDefault();
});
resetBtn.addEventListener("click", resetForm);
copyBtn.addEventListener("click", copyAddress);
clearHistoryBtn.addEventListener("click", clearHistory);

renderHistory();

function onInput() {
	const q = queryInput.value.trim();
	clearTimeout(debounceTimer);
	activeIndex = -1;

	if (q.length < MIN_QUERY_LEN) {
		hideSuggestions();
		setStatus("");
		return;
	}

	const delay = q.length === 1 ? 60 : DEBOUNCE_MS;
	debounceTimer = setTimeout(() => searchAddresses(q), delay);
}

async function searchAddresses(q) {
	if (abortController) {
		abortController.abort();
	}
	abortController = new AbortController();
	showSuggestionsLoading();

	const params = new URLSearchParams({
		q,
		limit: String(PHOTON_FETCH_LIMIT),
		lang: "de",
		bbox: DE_BBOX,
	});

	try {
		const res = await fetch(`${PHOTON_API}?${params}`, {
			signal: abortController.signal,
			headers: { Accept: "application/json" },
		});

		if (!res.ok) {
			throw new Error(`HTTP ${res.status}`);
		}

		const data = await res.json();
		const items = (data.features || [])
			.map(normalizeFeature)
			.filter(isSuggestionCandidate)
			.filter((item, i, arr) => arr.findIndex((x) => x.key === item.key) === i)
			.sort(compareSuggestionRank)
			.slice(0, SUGGESTION_LIMIT);

		currentSuggestions = items;
		renderSuggestions(items, q);
		setStatus(
			items.length
				? `${items.length} von max. ${SUGGESTION_LIMIT} Treffern`
				: "Keine passenden Adressen gefunden."
		);
	} catch (err) {
		if (err.name === "AbortError") {
			return;
		}
		hideSuggestions();
		setStatus("Suche fehlgeschlagen. Bitte später erneut versuchen.");
		console.error(err);
	}
}

function normalizeFeature(feature) {
	const p = feature.properties || {};
	const housenumber = (p.housenumber || "").trim();
	const plz = (p.postcode || "").trim();
	const stadt = (
		p.city ||
		p.town ||
		p.village ||
		p.municipality ||
		p.locality ||
		p.county ||
		""
	).trim();

	let street = (p.street || "").trim();

	/* Photon: Straßennamen oft nur in name (type street / highway) */
	if (!street && (p.type === "street" || p.osm_key === "highway") && p.name) {
		street = String(p.name).trim();
	}

	let streetLine = [street, housenumber].filter(Boolean).join(" ").trim();
	const label = buildLabel(p, streetLine, plz, stadt);

	if (!isPlaceOnlyType(p.type)) {
		streetLine = resolveStreetLine(streetLine, label, plz, stadt);
	} else {
		streetLine = "";
	}

	return {
		key: [streetLine, plz, stadt, p.osm_id].filter(Boolean).join("|"),
		label,
		street: streetLine,
		plz,
		stadt,
		type: p.type,
		osm_key: p.osm_key,
	};
}

function isPlaceOnlyType(type) {
	return ["city", "district", "locality", "state", "country"].includes(type);
}

/** Straße aus Anzeigetext, falls OSM kein street-Feld liefert */
function resolveStreetLine(streetLine, label, plz, stadt) {
	if (streetLine) {
		return streetLine;
	}
	return extractStreetFromLabel(label, plz, stadt);
}

function extractStreetFromLabel(label, plz, stadt) {
	if (!label || label === "Unbekannt") {
		return "";
	}

	const parts = label.split(",").map((s) => s.trim()).filter(Boolean);
	if (!parts.length) {
		return "";
	}

	const placeTail = [plz, stadt].filter(Boolean).join(" ");
	let candidate = parts[0];

	if (placeTail && candidate === placeTail && parts.length > 1) {
		candidate = parts[1];
	}

	if (stadt && candidate === stadt) {
		return "";
	}
	if (plz && candidate === plz) {
		return "";
	}

	/* Nur Ortsname ohne Straße/PLZ */
	if (parts.length === 1 && stadt && candidate === stadt && !plz) {
		return "";
	}

	return candidate;
}

function buildLabel(p, streetLine, plz, stadt) {
	const parts = [];
	if (streetLine) {
		parts.push(streetLine);
	} else if (p.name && p.type !== "house") {
		parts.push(p.name);
	}
	const place = [plz, stadt].filter(Boolean).join(" ");
	if (place) {
		parts.push(place);
	}
	if (!parts.length && p.name) {
		parts.push(p.name);
	}
	return parts.join(", ") || "Unbekannt";
}

/** Lockere Kriterien, damit schon bei kurzer Eingabe bis zu 10 sinnvolle Treffer möglich sind */
function isSuggestionCandidate(item) {
	if (!item.label || item.label === "Unbekannt") {
		return false;
	}
	const hasStreet = Boolean(item.street);
	const hasPlace = Boolean(item.plz || item.stadt);
	if (hasStreet && hasPlace) {
		return true;
	}
	if (item.plz && item.stadt) {
		return true;
	}
	if (hasStreet && item.stadt) {
		return true;
	}
	if (hasStreet && item.plz) {
		return true;
	}
	return false;
}

/** Vollständige Adressen zuerst, dann Straße+Ort, dann PLZ+Ort */
function compareSuggestionRank(a, b) {
	return suggestionRank(b) - suggestionRank(a);
}

function suggestionRank(item) {
	let score = 0;
	if (item.street && item.plz && item.stadt) {
		score += 8;
	}
	if (item.street) {
		score += 5;
	} else {
		score -= 6;
	}
	if (/\d/.test(item.street)) {
		score += 4;
	}
	if (item.type === "house") {
		score += 3;
	}
	if (item.plz && item.stadt) {
		score += 2;
	}
	return score;
}

function showSuggestionsLoading() {
	suggestionsEl.innerHTML = "";
	const li = document.createElement("li");
	li.className = "suggestions__item suggestions__item--loading";
	li.setAttribute("aria-disabled", "true");
	li.textContent = "Suche …";
	suggestionsEl.appendChild(li);
	suggestionsEl.hidden = false;
	queryInput.setAttribute("aria-expanded", "true");
}

function renderSuggestions(items, query) {
	suggestionsEl.innerHTML = "";
	activeIndex = -1;

	if (!items.length) {
		hideSuggestions();
		return;
	}

	const re = buildHighlightRegex(query);

	for (const [i, item] of items.entries()) {
		const li = document.createElement("li");
		li.className = "suggestions__item";
		li.role = "option";
		li.id = `suggestion-${i}`;
		li.dataset.index = String(i);
		li.innerHTML = highlightLabel(item.label, re);
		li.addEventListener("click", () => selectSuggestion(i));
		suggestionsEl.appendChild(li);
	}

	suggestionsEl.hidden = false;
	queryInput.setAttribute("aria-expanded", "true");
}

function buildHighlightRegex(query) {
	const tokens = query
		.trim()
		.split(/\s+/)
		.filter((t) => t.length >= 1)
		.map(escapeRegex);
	if (!tokens.length) {
		return null;
	}
	return new RegExp(`(${tokens.join("|")})`, "gi");
}

function escapeRegex(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightLabel(label, re) {
	if (!re) {
		return escapeHtml(label);
	}
	return escapeHtml(label).replace(re, "<mark>$1</mark>");
}

function escapeHtml(s) {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function selectSuggestion(index) {
	const item = currentSuggestions[index];
	if (!item) {
		return;
	}
	applyAddress(item);
	addToHistory(item);
}

function applyAddress(item) {
	const street = isPlaceOnlyType(item.type)
		? ""
		: resolveStreetLine(item.street, item.label, item.plz, item.stadt);

	streetInput.value = street;
	plzInput.value = item.plz;
	stadtInput.value = item.stadt;
	queryInput.value = item.label;
	hideSuggestions();
	updateCopyButton();
	setStatus(street ? "Adresse übernommen." : "Ort übernommen — Straße bitte ergänzen.");
}

function resetForm() {
	if (abortController) {
		abortController.abort();
	}
	clearTimeout(debounceTimer);
	queryInput.value = "";
	streetInput.value = "";
	plzInput.value = "";
	stadtInput.value = "";
	hideSuggestions();
	updateCopyButton();
	setStatus("");
	queryInput.focus();
}

function formatEntryClipboardText(street, plz, stadt) {
	return [street, plz, stadt].map((v) => (v || "").trim()).join("\n");
}

function getAddressClipboardText() {
	return formatEntryClipboardText(
		streetInput.value,
		plzInput.value,
		stadtInput.value
	);
}

function hasEntryToCopy(street, plz, stadt) {
	return Boolean(
		(street || "").trim() || (plz || "").trim() || (stadt || "").trim()
	);
}

function hasAddressToCopy() {
	return hasEntryToCopy(streetInput.value, plzInput.value, stadtInput.value);
}

function updateCopyButton() {
	copyBtn.disabled = !hasAddressToCopy();
}

async function copyTextToClipboard(text) {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return copyViaFallback(text);
	}
}

async function copyAddress() {
	const text = getAddressClipboardText();
	if (!hasAddressToCopy()) {
		setStatus("Nichts zum Kopieren.");
		return;
	}

	const ok = await copyTextToClipboard(text);
	if (ok) {
		setCopyFeedback(copyBtn);
		setStatus("Adresse in Zwischenablage kopiert.");
	} else {
		setStatus("Kopieren fehlgeschlagen.");
	}
}

async function copyHistoryEntry(entry, btn) {
	if (!hasEntryToCopy(entry.street, entry.plz, entry.stadt)) {
		setStatus("Nichts zum Kopieren.");
		return;
	}

	const text = formatEntryClipboardText(entry.street, entry.plz, entry.stadt);
	const ok = await copyTextToClipboard(text);
	if (ok) {
		setCopyFeedback(btn);
		setStatus("Adresse aus Verlauf kopiert.");
	} else {
		setStatus("Kopieren fehlgeschlagen.");
	}
}

function copyViaFallback(text) {
	const ta = document.createElement("textarea");
	ta.value = text;
	ta.setAttribute("readonly", "");
	ta.style.position = "fixed";
	ta.style.left = "-9999px";
	document.body.appendChild(ta);
	ta.select();
	const ok = document.execCommand("copy");
	document.body.removeChild(ta);
	return ok;
}

const copyFeedbackTimers = new WeakMap();

function setCopyFeedback(btn) {
	const prev = copyFeedbackTimers.get(btn);
	if (prev) {
		clearTimeout(prev);
	}

	const defaultLabel = btn.dataset.defaultLabel || btn.textContent;
	if (!btn.dataset.defaultLabel) {
		btn.dataset.defaultLabel = defaultLabel;
	}

	btn.textContent = "Kopiert!";
	btn.classList.add("btn--copied");

	const timer = setTimeout(() => {
		btn.textContent = btn.dataset.defaultLabel;
		btn.classList.remove("btn--copied");
		copyFeedbackTimers.delete(btn);
	}, 2000);
	copyFeedbackTimers.set(btn, timer);
}

function loadHistory() {
	try {
		const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
		const parsed = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function saveHistory() {
	localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
}

function addToHistory(item) {
	const street = resolveStreetLine(item.street, item.label, item.plz, item.stadt);
	const entry = {
		key: item.key,
		label: item.label,
		street,
		plz: item.plz,
		stadt: item.stadt,
		selectedAt: new Date().toISOString(),
	};
	history = [entry, ...history.filter((h) => h.key !== entry.key)].slice(0, MAX_HISTORY);
	saveHistory();
	renderHistory();
}

function removeFromHistory(key) {
	history = history.filter((h) => h.key !== key);
	saveHistory();
	renderHistory();
}

function clearHistory() {
	history = [];
	saveHistory();
	renderHistory();
	setStatus("Verlauf geleert.");
}

function renderHistory() {
	historyListEl.innerHTML = "";
	const hasItems = history.length > 0;

	historyEmptyEl.hidden = hasItems;
	historyListEl.hidden = !hasItems;
	clearHistoryBtn.hidden = !hasItems;

	if (!hasItems) {
		return;
	}

	for (const entry of history) {
		const li = document.createElement("li");
		li.className = "history__item";

		const pick = document.createElement("button");
		pick.type = "button";
		pick.className = "history__pick";
		pick.innerHTML = `<span>${escapeHtml(entry.label)}</span><span class="history__meta">${escapeHtml(formatHistoryMeta(entry))}</span>`;
		pick.addEventListener("click", () => applyAddress(entry));

		const tools = document.createElement("div");
		tools.className = "history__tools";

		const copy = document.createElement("button");
		copy.type = "button";
		copy.className = "history__copy";
		copy.setAttribute("aria-label", "Adresse aus Verlauf kopieren");
		copy.title = "Kopieren";
		copy.textContent = "⎘";
		copy.addEventListener("click", (e) => {
			e.stopPropagation();
			copyHistoryEntry(entry, copy);
		});

		const remove = document.createElement("button");
		remove.type = "button";
		remove.className = "history__remove";
		remove.setAttribute("aria-label", "Eintrag aus Verlauf entfernen");
		remove.textContent = "×";
		remove.addEventListener("click", (e) => {
			e.stopPropagation();
			removeFromHistory(entry.key);
		});

		tools.append(copy, remove);
		li.append(pick, tools);
		historyListEl.appendChild(li);
	}
}

function formatHistoryMeta(entry) {
	return formatHistoryDate(entry.selectedAt) || "";
}

function formatHistoryDate(iso) {
	if (!iso) {
		return "";
	}
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) {
		return "";
	}
	return date.toLocaleString("de-DE", {
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function onKeyDown(e) {
	if (suggestionsEl.hidden || !currentSuggestions.length) {
		return;
	}

	const max = currentSuggestions.length - 1;

	if (e.key === "ArrowDown") {
		e.preventDefault();
		activeIndex = activeIndex < max ? activeIndex + 1 : 0;
		updateActiveOption();
	} else if (e.key === "ArrowUp") {
		e.preventDefault();
		activeIndex = activeIndex > 0 ? activeIndex - 1 : max;
		updateActiveOption();
	} else if (e.key === "Enter" && activeIndex >= 0) {
		e.preventDefault();
		selectSuggestion(activeIndex);
	} else if (e.key === "Escape") {
		hideSuggestions();
	}
}

function updateActiveOption() {
	const options = suggestionsEl.querySelectorAll(".suggestions__item");
	options.forEach((el, i) => {
		el.classList.toggle("suggestions__item--active", i === activeIndex);
		if (i === activeIndex) {
			el.scrollIntoView({ block: "nearest" });
			queryInput.setAttribute("aria-activedescendant", el.id);
		}
	});
}

function hideSuggestions() {
	suggestionsEl.hidden = true;
	suggestionsEl.innerHTML = "";
	queryInput.setAttribute("aria-expanded", "false");
	queryInput.removeAttribute("aria-activedescendant");
	activeIndex = -1;
}

function setStatus(text) {
	statusEl.textContent = text;
}
