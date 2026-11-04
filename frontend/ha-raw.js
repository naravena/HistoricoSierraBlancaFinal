"use strict";
const energy = window.HAEnergy;
const $ = id => document.getElementById(id);
const number = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const chartTime = new Intl.DateTimeFormat("es-ES", {
  timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", hour: "2-digit", hourCycle: "h23",
});
const value = n => n === null ? "—" : number.format(n);
const escapeHTML = text => String(text).replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
const cache = new Map();
let model = null;
let loaded = null;
let controller = null;
let requestId = 0;
let samplePage = 0;
let summaryPage = 0;
let bins = [];
let filteredRows = [];
const pageSize = 50;

function message(text, error = false) {
  $("estado").textContent = text;
  $("estado").className = error ? "status error" : "status";
}

function metric(id, amount) {
  $(id).innerHTML = value(amount) + '<span class="unit">kWh</span>';
}

function selectedKeys() {
  return $("entity").value === "all" ? ["a", "b"] : [$("entity").value];
}

function renderChart() {
  const maximum = Math.max(0, ...bins.map(bin => bin.total || 0));
  if (!bins.some(bin => bin.total !== null)) {
    $("chart").innerHTML = '<div class="chart-empty">Sin pares de lecturas válidas para esta vista.</div>';
    return;
  }
  const width = Math.max(860, bins.length * 26 + 70);
  const height = 270;
  const left = 52;
  const top = 15;
  const plotHeight = 200;
  const step = (width - left - 14) / bins.length;
  const scaleMax = maximum > 0 ? maximum * 1.12 : 1;
  const pieces = ['<svg role="img" aria-label="Consumo observado por intervalo" viewBox="0 0 ' + width + ' ' + height + '" style="min-width:' + width + 'px"><title>Consumo observado en kWh</title>'];
  for (let i = 0; i <= 4; i++) {
    const y = top + plotHeight * (1 - i / 4);
    pieces.push('<line x1="' + left + '" y1="' + y + '" x2="' + (width - 14) + '" y2="' + y + '" stroke="#e6ece5"/><text x="42" y="' + (y + 4) + '" text-anchor="end" fill="#617570" font-size="10">' + value(scaleMax * i / 4) + "</text>");
  }
  bins.forEach((bin, index) => {
    const x = left + index * step + step * 0.22;
    let bottom = top + plotHeight;
    for (const key of selectedKeys()) {
      if (bin[key] === null) continue;
      const barHeight = bin[key] / scaleMax * plotHeight;
      const description = bin.label + " · " + energy.entities[key].label + " · " + value(bin[key]) + " kWh";
      pieces.push('<rect tabindex="0" aria-label="' + escapeHTML(description) + '" x="' + x + '" y="' + (bottom - Math.max(barHeight, 1)) + '" width="' + (step * 0.56) + '" height="' + Math.max(barHeight, 1) + '" rx="2" fill="' + energy.entities[key].color + '"><title>' + escapeHTML(description) + "</title></rect>");
      bottom -= barHeight;
    }
    if (bin.total === null) {
      pieces.push('<circle cx="' + (x + step * .28) + '" cy="' + (bottom + 3) + '" r="2" fill="#bfcac2"><title>' + escapeHTML(bin.label) + " · Sin pares válidos</title></circle>");
    }
    // Space labels without compressing the bars in long hourly ranges.
    if (index % Math.max(1, Math.ceil(65 / step)) === 0) {
      const label = $("group").value === "day" ? bin.label.slice(5) : chartTime.format(bin.key);
      pieces.push('<text x="' + (x + step * .28) + '" y="240" text-anchor="middle" fill="#617570" font-size="10">' + escapeHTML(label) + "</text>");
    }
  });
  pieces.push("</svg>");
  $("chart").innerHTML = pieces.join("");
}

function renderCoverage() {
  $("coverage").innerHTML = selectedKeys().map(key => {
    const series = model.series[key];
    const fields = [
      ["Lecturas válidas", series.rows.length - series.invalid],
      ["Primer contador", series.first ? value(series.first.value) + " kWh" : "—"],
      ["Primera muestra", series.first ? series.first.stamp : "—"],
      ["Último contador", series.last ? value(series.last.value) + " kWh" : "—"],
      ["Última muestra", series.last ? series.last.stamp : "—"],
      ["Mayor separación", series.maxGap ? Math.round(series.maxGap / 60000) + " min" : "—"],
      ["Estados inválidos", series.invalid],
      ["Descensos del contador", series.resets],
      ["Timestamps duplicados", series.duplicates],
      ["Fechas ilegibles descartadas", series.badDates],
    ];
    const warnings = [];
    if (!series.first) warnings.push("Sin muestras válidas en este intervalo.");
    else if (!series.pairs) warnings.push("No hay dos lecturas consecutivas válidas para calcular consumo.");
    if (series.resets) warnings.push("Los descensos se excluyen del sumatorio. Revisa los reinicios del sensor.");
    if (series.invalid) warnings.push("Los estados inválidos interrumpen la serie.");
    return '<article class="coverage-card"><h3><i class="dot ' + key + '"></i>' + energy.entities[key].label +
      "</h3><dl>" + fields.map(([label, text]) => "<dt>" + label + "</dt><dd>" + escapeHTML(text) + "</dd>").join("") +
      '</dl><p class="notice">' + escapeHTML(warnings.join(" ") || "Cobertura observada. Consulta las horas de inicio y final antes de comparar periodos.") + "</p></article>";
  }).join("");
}

function renderSummary() {
  const pages = Math.max(1, Math.ceil(bins.length / pageSize));
  summaryPage = Math.min(summaryPage, pages - 1);
  $("summary").innerHTML = bins.slice(summaryPage * pageSize, (summaryPage + 1) * pageSize).map(bin =>
    "<tr><td>" + escapeHTML(bin.label) + "</td><td>" + value(bin.a) + "</td><td>" + value(bin.b) +
    "</td><td>" + value(bin.total) + "</td></tr>").join("");
  $("summary-page").textContent = (summaryPage + 1) + " / " + pages;
  $("summary-prev").disabled = summaryPage === 0;
  $("summary-next").disabled = summaryPage >= pages - 1;
}

function filterSamples() {
  if (!model) return;
  const search = $("search").value.trim().toLocaleLowerCase("es");
  const quality = $("quality").value;
  filteredRows = selectedKeys().flatMap(key => model.series[key].rows).filter(row => {
    const matchesQuality = quality === "all" || (quality === "valid" ? row.valid : row.quality === quality);
    return matchesQuality && (row.stamp + " " + row.timestamp + " " + row.state + " " +
      energy.entities[row.key].label + " " + energy.entities[row.key].id).toLocaleLowerCase("es").includes(search);
  }).sort((a, b) => b.time - a.time || a.key.localeCompare(b.key));
  samplePage = 0;
  renderSamples();
}

function renderSamples() {
  const pages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  samplePage = Math.min(samplePage, pages - 1);
  const labels = { valid: "Válido", invalid: "Inválido", reset: "Descenso" };
  $("samples").innerHTML = filteredRows.slice(samplePage * pageSize, (samplePage + 1) * pageSize).map(row =>
    "<tr><td>" + escapeHTML(row.stamp) + "</td><td>" + energy.entities[row.key].label + "</td><td>" +
    escapeHTML(row.state) + "</td><td>" + value(row.delta) + '</td><td><span class="badge ' +
    (row.quality === "valid" ? "" : "warn") + '">' + labels[row.quality] + "</span></td></tr>").join("") ||
    '<tr><td colspan="5">No hay lecturas que coincidan con este filtro.</td></tr>';
  $("sample-page").textContent = filteredRows.length + " lecturas · " + (samplePage + 1) + " / " + pages;
  $("prev").disabled = samplePage === 0;
  $("next").disabled = samplePage >= pages - 1;
}

function render() {
  if (!model) return;
  bins = energy.buckets(model, $("group").value, $("entity").value);
  const totals = selectedKeys().map(key => model.series[key].total);
  const total = totals.every(n => n === null) ? null : totals.reduce((sum, n) => sum + (n ?? 0), 0);
  metric("total", total);
  const available = selectedKeys().filter(key => model.series[key].total !== null).length;
  $("total-note").textContent = available + " de " + selectedKeys().length + " plantas con pares válidos";
  for (const key of ["a", "b"]) {
    metric("total-" + key, model.series[key].total);
    const last = model.series[key].last;
    $("last-" + key).textContent = last ? "Último contador " + value(last.value) + " kWh" : "Sin muestras válidas";
  }
  const peak = bins.filter(bin => bin.total !== null).reduce((best, bin) =>
    !best || bin.total > best.total ? bin : best, null);
  metric("peak", peak ? peak.total : null);
  $("peak-note").textContent = peak ? peak.label : "Sin pares válidos";
  $("period").textContent = model.desde + " — " + model.hasta + " · " +
    (model.hasta === energy.dayOf(Date.now()) ? "Incluye hoy, día en curso" : "Intervalo observado");
  $("chart-note").textContent = ($("group").value === "hour" ? "Horas repetidas por cambio horario se distinguen por su offset en el detalle. " : "") +
    "— indica ausencia de pares válidos. El total puede ser parcial si falta una planta.";
  summaryPage = 0;
  renderChart();
  renderCoverage();
  renderSummary();
  filterSamples();
  $("dashboard").hidden = false;
}

function showEntry(entry, fromCache) {
  loaded = entry;
  model = entry.model;
  render();
  const count = Object.values(model.series).reduce((sum, series) => sum + series.rows.length, 0);
  const time = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(entry.time);
  message(count + " lecturas en el intervalo · Consultado a las " + time + " · " +
    (fromCache ? "Reutilizado de memoria" : "Recibido de Home Assistant") +
    (count ? "" : " · Recorder no devolvió muestras para estas fechas."));
}

async function load(force = false) {
  const desde = $("desde").value;
  const hasta = $("hasta").value;
  if (!energy.validRange(desde, hasta) || hasta > energy.dayOf(Date.now())) {
    message("Elige fechas válidas, sin días futuros, y un máximo de 31 días inclusivos.", true);
    return;
  }
  const id = ++requestId;
  controller?.abort();
  const key = desde + "/" + hasta;
  const cached = cache.get(key);
  if (!force && cached && Date.now() - cached.time < 60000) {
    $("consultar").disabled = $("refresh").disabled = false;
    $("dashboard").removeAttribute("aria-busy");
    showEntry(cached, true);
    return;
  }
  controller = new AbortController();
  $("consultar").disabled = $("refresh").disabled = true;
  $("dashboard").setAttribute("aria-busy", "true");
  message("Consultando " + desde + " — " + hasta + " en Home Assistant…");
  try {
    const response = await fetch("/api/ha/raw?" + new URLSearchParams({ desde, hasta }), {
      credentials: "include", cache: "no-store",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35000)]),
    });
    if (response.status === 401) {
      window.location.href = "/login.html";
      return;
    }
    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); }
    catch { throw new Error("El servidor devolvió una respuesta ilegible. Prueba de nuevo o acorta el intervalo."); }
    if (!response.ok) throw new Error(payload.error || "La consulta devolvió HTTP " + response.status);
    if (payload.desde !== desde || payload.hasta !== hasta) throw new Error("La respuesta no corresponde al intervalo solicitado.");
    const entry = { model: energy.analyze(payload), text, time: Date.now() };
    if (id !== requestId) return;
    cache.delete(key);
    cache.set(key, entry);
    while (cache.size > 3) cache.delete(cache.keys().next().value);
    showEntry(entry, false);
  } catch (error) {
    if (id !== requestId) return;
    const detail = error.name === "TimeoutError" ? "La consulta tardó demasiado. Prueba un intervalo más corto." :
      error.name === "TypeError" ? "No se pudo conectar. Revisa la conexión y vuelve a intentarlo." : error.message;
    message(detail + (model ? " Se mantienen los datos del intervalo " + model.desde + " — " + model.hasta + "." : ""), true);
  } finally {
    if (id === requestId) {
      $("consultar").disabled = $("refresh").disabled = false;
      $("dashboard").removeAttribute("aria-busy");
    }
  }
}

function preset(days) {
  const today = energy.dayOf(Date.now());
  $("hasta").value = days === 1 ? energy.shiftDay(today, -1) : today;
  $("desde").value = days <= 1 ? $("hasta").value : energy.shiftDay(today, 1 - days);
  document.querySelectorAll("[data-days]").forEach(button => {
    const active = Number(button.dataset.days) === days;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("raw-form").addEventListener("submit", event => { event.preventDefault(); load(); });
$("refresh").addEventListener("click", () => load(true));
document.querySelectorAll("[data-days]").forEach(button => button.addEventListener("click", () => {
  preset(Number(button.dataset.days));
  load();
}));
for (const id of ["desde", "hasta"]) $(id).addEventListener("change", () => {
  document.querySelectorAll("[data-days]").forEach(button => {
    button.classList.remove("active");
    button.setAttribute("aria-pressed", "false");
  });
});
$("entity").addEventListener("change", render);
$("group").addEventListener("change", render);
$("quality").addEventListener("change", filterSamples);
let searchTimer;
$("search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(filterSamples, 150);
});
$("prev").addEventListener("click", () => { samplePage--; renderSamples(); });
$("next").addEventListener("click", () => { samplePage++; renderSamples(); });
$("summary-prev").addEventListener("click", () => { summaryPage--; renderSummary(); });
$("summary-next").addEventListener("click", () => { summaryPage++; renderSummary(); });
$("json").addEventListener("click", () => {
  if (loaded) download("ha-" + model.desde + "-" + model.hasta + ".json", loaded.text, "application/json");
});
$("csv").addEventListener("click", () => {
  if (!model) return;
  const rows = [["intervalo_madrid", "baja_kwh", "alta_kwh", "total_observado_kwh"],
    ...bins.map(bin => [bin.label, bin.a, bin.b, bin.total])];
  const csv = rows.map(row => row.map(cell => '"' + String(cell ?? "").replace(/"/g, '""') + '"').join(";")).join("\r\n");
  download("energia-" + model.desde + "-" + model.hasta + ".csv", "\uFEFF" + csv, "text/csv;charset=utf-8");
});
$("logout").addEventListener("click", async () => {
  try {
    const response = await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    if (!response.ok) throw new Error("No se pudo cerrar la sesión.");
    controller?.abort();
    cache.clear();
    window.location.href = "/login.html";
  } catch { message("No se pudo cerrar la sesión. Vuelve a intentarlo.", true); }
});
$("desde").max = $("hasta").max = energy.dayOf(Date.now());
preset(0);
load();
