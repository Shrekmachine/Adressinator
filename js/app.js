const PHOTON_API = "https://photon.komoot.io/api/";
const DEBOUNCE_MS = 100;
const MIN_QUERY_LEN = 1;
const SUGGESTION_LIMIT = 10;
/** Mehr von der API holen, damit nach dem Filtern oft 10 Treffer übrig bleiben */
const PHOTON_FETCH_LIMIT = 30;
const MAX_HISTORY = 25;
const MAX_STARTS = 10;
const HISTORY_STORAGE_KEY = "adressinator-history";
const STARTS_STORAGE_KEY = "adressinator-starts";
const SELECTED_START_KEY = "adressinator-selected-start";
const CLEAR_ON_EXIT_KEY = "adressinator-clear-on-exit";
/** Deutschland (minLon, minLat, maxLon, maxLat) */
const DE_BBOX = "5.87,47.27,15.04,55.06";

const queryInput = document.getElementById("address-query");
const searchLabelEl = document.getElementById("search-label");
const searchModeRadios = document.querySelectorAll('input[name="search-mode"]');
const suggestionsEl = document.getElementById("suggestions");
const statusEl = document.getElementById("search-status");
const streetInput = document.getElementById("street");
const plzInput = document.getElementById("plz");
const stadtInput = document.getElementById("stadt");
const resetBtn = document.getElementById("reset-btn");
const copyBtn = document.getElementById("copy-btn");
const mapsLink = document.getElementById("maps-link");
const saveStartBtn = document.getElementById("save-start-btn");
const startSelectEl = document.getElementById("start-select");
const routeBtn = document.getElementById("route-btn");
const removeStartBtn = document.getElementById("remove-start-btn");
const historyListEl = document.getElementById("history-list");
const historyEmptyEl = document.getElementById("history-empty");
const clearHistoryBtn = document.getElementById("clear-history-btn");
const clearOnExitCheckbox = document.getElementById("clear-on-exit");

let debounceTimer = null;
let activeIndex = -1;
let currentSuggestions = [];
let abortController = null;
let history = loadHistory();
let starts = loadStarts();
let selectedStartKey = loadSelectedStartKey();
let searchMode = "destination";
let selectedLat = null;
let selectedLon = null;

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
saveStartBtn.addEventListener("click", saveCurrentAsStart);
searchModeRadios.forEach((radio) => {
	radio.addEventListener("change", onSearchModeChange);
});
startSelectEl.addEventListener("change", onStartSelectChange);
routeBtn.addEventListener("click", openRouteWithSelectedStart);
removeStartBtn.addEventListener("click", removeSelectedStart);
clearHistoryBtn.addEventListener("click", clearHistory);
clearOnExitCheckbox.addEventListener("change", onClearOnExitChange);
window.addEventListener("pagehide", clearHistoryOnExitIfEnabled);

initClearOnExit();
syncSelectedStartKey();
updateSearchModeUi();
renderStartSelect();
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

async function fetchPhotonSuggestions(q, signal) {
	const params = new URLSearchParams({
		q,
		limit: String(PHOTON_FETCH_LIMIT),
		lang: "de",
		bbox: DE_BBOX,
	});

	const res = await fetch(`${PHOTON_API}?${params}`, {
		signal,
		headers: { Accept: "application/json" },
	});

	if (!res.ok) {
		throw new Error(`HTTP ${res.status}`);
	}

	const data = await res.json();
	return (data.features || [])
		.map(normalizeFeature)
		.filter(isSuggestionCandidate)
		.filter((item, i, arr) => arr.findIndex((x) => x.key === item.key) === i)
		.sort(compareSuggestionRank)
		.slice(0, SUGGESTION_LIMIT);
}

async function searchAddresses(q) {
	if (abortController) {
		abortController.abort();
	}
	abortController = new AbortController();
	showSuggestionsLoading();

	try {
		const items = await fetchPhotonSuggestions(q, abortController.signal);
		currentSuggestions = items;
		renderSuggestionList(items, q);
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

function onSearchModeChange() {
	searchMode =
		document.querySelector('input[name="search-mode"]:checked')?.value ||
		"destination";
	updateSearchModeUi();
	queryInput.focus();
}

function updateSearchModeUi() {
	const isStart = searchMode === "start";
	searchLabelEl.textContent = isStart
		? "Startadresse suchen"
		: "Zieladresse suchen";
	queryInput.placeholder = isStart
		? "z.\u202fB. Büro, Lager, Zuhause"
		: "z.\u202fB. Hauptstraße 12, 70173 Stuttgart";
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

	const coords = feature.geometry?.coordinates;
	const lon = Number.isFinite(coords?.[0]) ? coords[0] : null;
	const lat = Number.isFinite(coords?.[1]) ? coords[1] : null;

	return {
		key: [streetLine, plz, stadt, p.osm_id].filter(Boolean).join("|"),
		label,
		street: streetLine,
		plz,
		stadt,
		type: p.type,
		osm_key: p.osm_key,
		lat,
		lon,
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

function renderSuggestionList(items, query) {
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

	if (searchMode === "start") {
		if (addStartFromItem(item)) {
			setStatus("Startadresse gespeichert und ausgewählt.");
		}
		queryInput.value = "";
		hideSuggestions();
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
	selectedLat = item.lat ?? null;
	selectedLon = item.lon ?? null;
	hideSuggestions();
	updateResultActions();
	renderHistory();
	setStatus(street ? "Adresse übernommen." : "Ort übernommen — Straße bitte ergänzen.");
}

function applyAddressFromHistory(entry) {
	applyAddress({
		...entry,
		type: "house",
	});
	setStatus(`Ziel: ${entry.label}`);
}

function isCurrentDestination(entry) {
	return queryInput.value.trim() === (entry.label || "").trim();
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
	selectedLat = null;
	selectedLon = null;
	hideSuggestions();
	updateResultActions();
	renderHistory();
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

function formatMapsLocation(street, plz, stadt, lat, lon, label = "") {
	if (lat != null && lon != null) {
		return `${lat},${lon}`;
	}

	const query = [street, plz, stadt]
		.map((v) => (v || "").trim())
		.filter(Boolean)
		.join(", ");

	if (query) {
		return query;
	}

	return (label || "").trim() || null;
}

function buildGoogleMapsUrl(street, plz, stadt, lat, lon) {
	const location = formatMapsLocation(street, plz, stadt, lat, lon);
	if (!location) {
		return null;
	}

	if (lat != null && lon != null) {
		return `https://www.google.com/maps?q=${encodeURIComponent(location)}`;
	}

	return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

function buildDirectionsUrl(origin, destination) {
	const originParam = formatMapsLocation(
		origin.street,
		origin.plz,
		origin.stadt,
		origin.lat,
		origin.lon,
		origin.label
	);
	const destParam = formatMapsLocation(
		destination.street,
		destination.plz,
		destination.stadt,
		destination.lat,
		destination.lon,
		destination.label
	);

	if (!originParam || !destParam) {
		return null;
	}

	/* api=1 erfordert origin/destination als Query-Parameter (nicht /dir/A/B im Pfad) */
	const url = new URL("https://www.google.com/maps/dir/");
	url.searchParams.set("api", "1");
	url.searchParams.set("origin", originParam);
	url.searchParams.set("destination", destParam);
	url.searchParams.set("travelmode", "driving");
	return url.toString();
}

function getCurrentDestination() {
	return {
		street: streetInput.value,
		plz: plzInput.value,
		stadt: stadtInput.value,
		lat: selectedLat,
		lon: selectedLon,
		label: queryInput.value.trim(),
	};
}

function getGoogleMapsLink() {
	const start = getSelectedStart();
	const destination = getCurrentDestination();

	if (start && hasDestination()) {
		const routeUrl = buildDirectionsUrl(start, destination);
		if (routeUrl) {
			return { url: routeUrl, mode: "route" };
		}
	}

	const destUrl = buildGoogleMapsUrl(
		destination.street,
		destination.plz,
		destination.stadt,
		destination.lat,
		destination.lon
	);

	if (destUrl) {
		return { url: destUrl, mode: "destination" };
	}

	return null;
}

function hasDestination() {
	return Boolean(
		formatMapsLocation(
			streetInput.value,
			plzInput.value,
			stadtInput.value,
			selectedLat,
			selectedLon,
			queryInput.value.trim()
		)
	);
}

function createStartEntry(item) {
	const street = isPlaceOnlyType(item.type)
		? ""
		: resolveStreetLine(item.street, item.label, item.plz, item.stadt);

	return {
		key: `start|${item.key}`,
		label: item.label,
		street,
		plz: item.plz,
		stadt: item.stadt,
		lat: item.lat ?? null,
		lon: item.lon ?? null,
		addedAt: new Date().toISOString(),
	};
}

function entryToStartKey(key) {
	return key.startsWith("start|") ? key : `start|${key}`;
}

function entryToStartEntry(entry) {
	return {
		key: entryToStartKey(entry.key),
		label: entry.label,
		street: entry.street || "",
		plz: entry.plz || "",
		stadt: entry.stadt || "",
		lat: entry.lat ?? null,
		lon: entry.lon ?? null,
		addedAt: entry.addedAt || new Date().toISOString(),
	};
}

function loadStarts() {
	try {
		const raw = localStorage.getItem(STARTS_STORAGE_KEY);
		const parsed = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function loadSelectedStartKey() {
	return localStorage.getItem(SELECTED_START_KEY) || "";
}

function saveStarts() {
	localStorage.setItem(STARTS_STORAGE_KEY, JSON.stringify(starts));
}

function persistSelectedStartKey() {
	if (selectedStartKey) {
		localStorage.setItem(SELECTED_START_KEY, selectedStartKey);
	} else {
		localStorage.removeItem(SELECTED_START_KEY);
	}
}

function syncSelectedStartKey() {
	if (selectedStartKey && !starts.some((s) => s.key === selectedStartKey)) {
		selectedStartKey = starts[0]?.key || "";
		persistSelectedStartKey();
	}
}

function setSelectedStartKey(key) {
	selectedStartKey = key || "";
	persistSelectedStartKey();
	renderStartSelect();
	updateResultActions();
}

function getSelectedStart() {
	return starts.find((s) => s.key === selectedStartKey) || null;
}

function isSelectedStartKey(key) {
	return selectedStartKey === entryToStartKey(key);
}

function addStartFromItem(item) {
	const entry = createStartEntry(item);
	const exists = starts.some((s) => s.key === entry.key);

	if (!exists) {
		if (starts.length >= MAX_STARTS) {
			setStatus(`Maximal ${MAX_STARTS} Startadressen.`);
			return false;
		}
		starts = [entry, ...starts];
		saveStarts();
	}

	setSelectedStartKey(entry.key);
	return true;
}

function saveCurrentAsStart() {
	if (!hasAddressToCopy()) {
		setStatus("Keine Adresse zum Speichern.");
		return;
	}

	const item = {
		key: [streetInput.value, plzInput.value, stadtInput.value, selectedLat, selectedLon]
			.filter((v) => v != null && v !== "")
			.join("|"),
		label: queryInput.value.trim() || formatMapsLocation(
			streetInput.value,
			plzInput.value,
			stadtInput.value,
			selectedLat,
			selectedLon
		),
		street: streetInput.value,
		plz: plzInput.value,
		stadt: stadtInput.value,
		lat: selectedLat,
		lon: selectedLon,
		type: "house",
	};

	if (addStartFromItem(item)) {
		setStatus("Als Startadresse gespeichert und ausgewählt.");
	}
}

function setAsStartFromHistory(entry) {
	if (addStartFromItem(entryToStartEntry(entry))) {
		setStatus(`Startadresse: ${entry.label}`);
	}
}

function onStartSelectChange() {
	setSelectedStartKey(startSelectEl.value);
	if (selectedStartKey) {
		const start = getSelectedStart();
		setStatus(start ? `Start: ${start.label}` : "");
	}
}

function removeSelectedStart() {
	if (!selectedStartKey) {
		return;
	}

	const key = selectedStartKey;
	starts = starts.filter((s) => s.key !== key);
	saveStarts();
	setSelectedStartKey(starts[0]?.key || "");
	setStatus("Startadresse aus Liste entfernt.");
}

function openRouteWithSelectedStart() {
	const link = getGoogleMapsLink();
	if (!link || link.mode !== "route") {
		setStatus("Route nicht möglich — Start und Zieladresse wählen.");
		return;
	}

	window.open(link.url, "_blank", "noopener,noreferrer");
	const start = getSelectedStart();
	setStatus(`Route in Google Maps: ${start?.label || "Start"} → Ziel`);
}

function updateRouteButton() {
	const canRoute = Boolean(getSelectedStart() && hasDestination());
	routeBtn.disabled = !canRoute;
	routeBtn.title = canRoute
		? "Route in Google Maps planen"
		: "Start und Ziel wählen";
}

function renderStartSelect() {
	const previous = startSelectEl.value;
	startSelectEl.innerHTML = "";

	const placeholder = document.createElement("option");
	placeholder.value = "";
	placeholder.textContent = starts.length
		? "— Start wählen —"
		: "Noch keine Startadressen";
	startSelectEl.appendChild(placeholder);

	for (const entry of starts) {
		const option = document.createElement("option");
		option.value = entry.key;
		option.textContent = entry.label;
		startSelectEl.appendChild(option);
	}

	startSelectEl.disabled = !starts.length;
	removeStartBtn.hidden = !starts.length;

	syncSelectedStartKey();
	startSelectEl.value = selectedStartKey || "";

	if (!selectedStartKey && previous) {
		startSelectEl.value = "";
	}

	updateRouteButton();
}

function updateResultActions() {
	const hasCopy = hasAddressToCopy();
	copyBtn.disabled = !hasCopy;
	saveStartBtn.hidden = !hasCopy;

	const maps = getGoogleMapsLink();

	if (maps) {
		mapsLink.href = maps.url;
		mapsLink.textContent =
			maps.mode === "route" ? "Route in Maps" : "Ziel in Maps";
		mapsLink.hidden = false;
	} else {
		mapsLink.hidden = true;
		mapsLink.removeAttribute("href");
	}

	updateRouteButton();
	renderHistory();
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
		lat: item.lat ?? null,
		lon: item.lon ?? null,
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

function initClearOnExit() {
	clearOnExitCheckbox.checked = isClearOnExitEnabled();
}

function isClearOnExitEnabled() {
	return localStorage.getItem(CLEAR_ON_EXIT_KEY) === "1";
}

function onClearOnExitChange() {
	localStorage.setItem(CLEAR_ON_EXIT_KEY, clearOnExitCheckbox.checked ? "1" : "0");
}

function clearHistoryOnExitIfEnabled() {
	if (!isClearOnExitEnabled()) {
		return;
	}
	localStorage.removeItem(HISTORY_STORAGE_KEY);
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

		const body = document.createElement("div");
		body.className = "history__body";
		body.innerHTML = `<span>${escapeHtml(entry.label)}</span><span class="history__meta">${escapeHtml(formatHistoryMeta(entry))}</span>`;

		const tools = document.createElement("div");
		tools.className = "history__tools";

		const setZiel = document.createElement("button");
		setZiel.type = "button";
		setZiel.className = "history__ziel";
		if (isCurrentDestination(entry)) {
			setZiel.classList.add("history__ziel--active");
			setZiel.setAttribute("aria-pressed", "true");
		}
		setZiel.setAttribute("aria-label", "Als Zieladresse übernehmen");
		setZiel.title = "Als Zieladresse übernehmen";
		setZiel.textContent = "Ziel";
		setZiel.addEventListener("click", (e) => {
			e.stopPropagation();
			applyAddressFromHistory(entry);
		});

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

		const setStart = document.createElement("button");
		setStart.type = "button";
		setStart.className = "history__start";
		if (isSelectedStartKey(entry.key)) {
			setStart.classList.add("history__start--active");
			setStart.setAttribute("aria-pressed", "true");
		}
		setStart.setAttribute("aria-label", "Als Startadresse setzen");
		setStart.title = "Als Startadresse setzen";
		setStart.textContent = "Start";
		setStart.addEventListener("click", (e) => {
			e.stopPropagation();
			setAsStartFromHistory(entry);
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

		tools.append(setStart, setZiel, copy, remove);
		li.append(body, tools);
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
