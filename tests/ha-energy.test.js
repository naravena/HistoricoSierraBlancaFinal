const test = require("node:test");
const assert = require("node:assert/strict");
const energy = require("../frontend/ha-energy-analysis");

function state(key, time, value, attributes = {}) {
  return {
    entity_id: energy.entities[key].id, state: value,
    attributes: { unit_of_measurement: "kWh", state_class: "total_increasing", ...attributes },
    last_updated: time,
  };
}
function analyze(rows, desde = "2026-11-04", hasta = desde) {
  return energy.analyze({ desde, hasta, raw: [rows] });
}

test("uses the supplied cumulative values as deltas, preserving raw input", () => {
  const rows = [
    state("a", "2026-11-03T23:01:25.675745+00:00", "952.28"),
    state("a", "2026-11-03T23:07:24.790292+00:00", "952.29"),
    state("a", "2026-11-03T23:10:38.605114+00:00", "952.3"),
    state("a", "2026-11-03T23:19:22.871621+00:00", "952.31"),
    state("a", "2026-11-03T23:25:21.961600+00:00", "952.33"),
  ];
  const original = JSON.stringify(rows);
  const model = analyze(rows);
  assert.ok(Math.abs(model.series.a.total - 0.05) < 1e-9);
  assert.equal(model.series.a.last.value, 952.33);
  assert.equal(model.series.b.total, null);
  assert.equal(energy.buckets(model, "day")[0].b, null);
  assert.equal(JSON.stringify(rows), original);
});

test("never treats an empty state, unsupported unit or unavailable as zero", () => {
  const model = analyze([
    state("a", "2026-11-04T01:00:00Z", "100"),
    state("a", "2026-11-04T02:00:00Z", "unavailable"),
    state("a", "2026-11-04T03:00:00Z", "105"),
    state("a", "2026-11-04T04:00:00Z", "106"),
    state("a", "2026-11-04T05:00:00Z", ""),
    state("a", "2026-11-04T06:00:00Z", "999", { unit_of_measurement: "Wh" }),
  ]);
  assert.equal(model.series.a.total, 1);
  assert.equal(model.series.a.invalid, 3);
});

test("excludes descents and resumes from the new baseline", () => {
  const model = analyze([
    state("a", "2026-11-04T01:00:00Z", "50"),
    state("a", "2026-11-04T02:00:00Z", "52"),
    state("a", "2026-11-04T03:00:00Z", "1"),
    state("a", "2026-11-04T04:00:00Z", "4"),
  ]);
  assert.equal(model.series.a.total, 5);
  assert.equal(model.series.a.resets, 1);
  assert.equal(model.series.a.rows[2].delta, null);
});

test("sorts, deduplicates and breaks at conflicting duplicate timestamps", () => {
  const model = analyze([
    state("a", "2026-11-04T04:00:00Z", "4"),
    state("a", "2026-11-04T01:00:00Z", "1"),
    state("a", "2026-11-04T01:00:00Z", "1"),
    state("a", "2026-11-04T02:00:00Z", "2"),
    state("a", "2026-11-04T02:00:00Z", "9"),
    state("a", "2026-11-04T03:00:00Z", "3"),
    state("a", "2026-11-04T05:00:00", "99"),
  ]);
  assert.equal(model.series.a.total, 1);
  assert.equal(model.series.a.duplicates, 2);
  assert.equal(model.series.a.badDates, 1);
});

test("retains 23 and 25 local hours and distinguishes the repeated autumn hour", () => {
  const spring = energy.buckets(analyze([], "2026-03-29"), "hour");
  const autumn = energy.buckets(analyze([], "2026-10-25"), "hour");
  assert.equal(spring.length, 23);
  assert.equal(autumn.length, 25);
  const twoAM = autumn.filter(bin => bin.label.includes("02:00:00"));
  assert.equal(twoAM.length, 2);
  assert.notEqual(twoAM[0].label, twoAM[1].label);
});

test("attributes cross-midnight increments to their origin and includes empty days", () => {
  const model = analyze([
    state("a", "2026-11-03T22:59:00Z", "1"), // outside the range
    state("a", "2026-11-04T22:50:00Z", "10"),
    state("a", "2026-11-04T23:10:00Z", "12"),
    state("b", "2026-11-04T23:20:00Z", "100"),
    state("b", "2026-11-04T23:40:00Z", "103"),
    state("a", "2026-11-06T23:00:00Z", "999"), // exclusive end
  ], "2026-11-04", "2026-11-06");
  const bins = energy.buckets(model, "day");
  assert.deepEqual(bins.map(bin => bin.total), [2, 3, null]);
  assert.deepEqual(energy.buckets(model, "day", "a").map(bin => bin.total), [2, null, null]);
});

test("zero observed consumption remains distinct from missing pairs", () => {
  const model = analyze([
    state("a", "2026-11-04T01:00:00Z", "1"),
    state("a", "2026-11-04T02:00:00Z", "1"),
    state("b", "2026-11-04T02:00:00Z", "50"),
  ]);
  assert.equal(model.series.a.total, 0);
  assert.equal(model.series.b.total, null);
});

test("validates inclusive 31-day limits and rejects impossible dates", () => {
  assert.equal(energy.validRange("2026-01-01", "2026-01-31"), true);
  assert.equal(energy.validRange("2026-01-01", "2026-02-01"), false);
  assert.equal(energy.validRange("2026-02-30", "2026-03-01"), false);
});
