(function (root) {
  "use strict";
  const entities = {
    a: { id: "sensor.sierra_blanca_energia_consumida_a", label: "Planta Baja", color: "#2d8070" },
    b: { id: "sensor.sierra_blanca_energia_consumida_b", label: "Planta Alta", color: "#d9a34d" },
  };
  const dayFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
  });
  const clockFormatter = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "shortOffset",
  });
  const midnightFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });

  function dayOf(time) {
    const parts = Object.fromEntries(dayFormatter.formatToParts(time).map(p => [p.type, p.value]));
    return parts.year + "-" + parts.month + "-" + parts.day;
  }

  function shiftDay(day, amount) {
    const date = new Date(day + "T12:00:00Z");
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
  }

  function midnight(day) {
    const target = Date.parse(day + "T00:00:00Z");
    let guess = target;
    for (let i = 0; i < 4; i++) {
      const p = Object.fromEntries(midnightFormatter.formatToParts(guess).map(part => [part.type, part.value]));
      guess += target - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    }
    return guess;
  }

  function validRange(from, to) {
    const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      value >= "0100-01-01" && value < "9999-12-31" &&
      Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
      new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
    return valid(from) && valid(to) && from <= to &&
      (Date.parse(to) - Date.parse(from)) / 86400000 < 31;
  }

  function analyze(payload) {
    if (!payload || !validRange(payload.desde, payload.hasta) ||
        !Array.isArray(payload.raw) || !payload.raw.every(Array.isArray)) {
      throw new Error("Home Assistant devolvió un historial con formato inesperado.");
    }
    const start = midnight(payload.desde);
    const end = midnight(shiftDay(payload.hasta, 1));
    const series = {};
    for (const [key, entity] of Object.entries(entities)) {
      const rows = [];
      let badDates = 0;
      for (const group of payload.raw) {
        for (const state of group) {
          if (!state || state.entity_id !== entity.id) continue;
          const timestamp = state.last_updated || state.last_changed;
          // Timestamps without a timezone would depend on the visitor's computer.
          const time = typeof timestamp === "string" && /(?:Z|[+-]\d{2}:\d{2})$/i.test(timestamp)
            ? Date.parse(timestamp) : NaN;
          if (!Number.isFinite(time)) { badDates++; continue; }
          if (time < start || time >= end) continue;
          const numeric = typeof state.state === "string" && state.state.trim() !== "" &&
            Number.isFinite(Number(state.state)) && Number(state.state) >= 0;
          const attributes = state.attributes || {};
          const supported = (!attributes.unit_of_measurement || attributes.unit_of_measurement === "kWh") &&
            (!attributes.state_class || attributes.state_class === "total_increasing");
          rows.push({
            key, time, timestamp, state: String(state.state ?? ""), value: numeric ? Number(state.state) : null,
            valid: numeric && supported, delta: null, quality: "invalid",
            stamp: clockFormatter.format(time), day: dayOf(time),
          });
        }
      }
      rows.sort((a, b) => a.time - b.time);
      const unique = [];
      let duplicates = 0;
      for (const row of rows) {
        const previous = unique.at(-1);
        if (previous && previous.time === row.time) {
          duplicates++;
          if (previous.state !== row.state || !row.valid) previous.valid = false;
          continue;
        }
        unique.push(row);
      }
      let previous = null;
      let total = 0;
      let pairs = 0;
      let resets = 0;
      let maxGap = 0;
      let invalid = 0;
      const increments = [];
      for (const row of unique) {
        if (!row.valid) { invalid++; previous = null; continue; }
        row.quality = "valid";
        if (previous) {
          const delta = row.value - previous.value;
          maxGap = Math.max(maxGap, row.time - previous.time);
          if (delta < -0.0000001) {
            row.quality = "reset";
            resets++;
          } else {
            row.delta = Math.max(0, delta);
            total += row.delta;
            pairs++;
            increments.push({ time: previous.time, end: row.time, delta: row.delta });
          }
        }
        previous = row;
      }
      const valid = unique.filter(row => row.valid);
      series[key] = {
        rows: unique, increments, total: pairs ? total : null, pairs, resets, invalid,
        duplicates, badDates, maxGap, first: valid[0] || null, last: valid.at(-1) || null,
      };
    }
    return { desde: payload.desde, hasta: payload.hasta, start, end, series };
  }

  function buckets(model, grouping, selection = "all") {
    const bins = new Map();
    if (grouping === "hour") {
      for (let time = model.start; time < model.end; time += 3600000) {
        bins.set(time, { key: time, label: clockFormatter.format(time), a: null, b: null });
      }
    } else {
      for (let day = model.desde; day <= model.hasta; day = shiftDay(day, 1)) {
        bins.set(day, { key: day, label: day, a: null, b: null });
      }
    }
    for (const key of Object.keys(entities)) {
      if (selection !== "all" && selection !== key) continue;
      for (const increment of model.series[key].increments) {
        const id = grouping === "hour" ? Math.floor(increment.time / 3600000) * 3600000 : dayOf(increment.time);
        const bin = bins.get(id);
        if (bin) bin[key] = (bin[key] ?? 0) + increment.delta;
      }
    }
    return [...bins.values()].map(bin => ({
      ...bin, total: bin.a === null && bin.b === null ? null : (bin.a ?? 0) + (bin.b ?? 0),
    }));
  }

  const api = { entities, dayOf, shiftDay, midnight, validRange, analyze, buckets };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HAEnergy = api;
})(typeof globalThis === "undefined" ? this : globalThis);
