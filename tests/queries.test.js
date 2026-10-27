const test = require("node:test");
const assert = require("node:assert/strict");
const { consumoDiarioPorPlanta, consumoTotalPorPlanta } = require("../src/queries");

function mockDb(rows) {
  return { async execute(args) { this.call = args; return { rows }; } };
}

test("agrupa por día local de Málaga y marca cobertura parcial", async () => {
  const db = mockDb([
    { entity_id: "sensor.sierra_blanca_energia_consumida_a", origen: "statistics", recorded_at: "2026-09-27T21:00:00Z", contador: 431.50 },
    { entity_id: "sensor.sierra_blanca_energia_consumida_a", origen: "statistics", recorded_at: "2026-09-27T22:00:00Z", contador: 431.57 },
    { entity_id: "sensor.sierra_blanca_energia_consumida_a", origen: "statistics", recorded_at: "2026-09-28T15:00:00Z", contador: 432.14 },
    { entity_id: "sensor.sierra_blanca_energia_consumida_b", origen: "statistics", recorded_at: "2026-09-27T21:00:00Z", contador: 226.50 },
    { entity_id: "sensor.sierra_blanca_energia_consumida_b", origen: "statistics", recorded_at: "2026-09-27T22:00:00Z", contador: 226.61 },
    { entity_id: "sensor.sierra_blanca_energia_consumida_b", origen: "statistics", recorded_at: "2026-09-28T15:00:00Z", contador: 229.20 },
  ]);
  const result = await consumoDiarioPorPlanta(db, "2026-09-28", "2026-09-28");
  assert.deepEqual(result.dias, ["2026-09-28"]);
  assert.deepEqual(result.plantaBaja, [0.57]);
  assert.deepEqual(result.plantaAlta, [2.59]);
  assert.deepEqual(result.totales, { baja: 0.57, alta: 2.59, total: 3.16 });
  assert.deepEqual(result.diasIncompletos, ["2026-09-28"]);
  assert.match(db.call.sql, /FROM historical_data/);
  assert.match(db.call.sql, /record_type = 'statistics'/);
  assert.match(db.call.sql, /siguientes AS/);
  assert.doesNotMatch(db.call.sql, /FROM readings\b/);
});

test("atribuye al día de origen el delta que termina en la primera lectura tras medianoche", async () => {
  const db = mockDb([
    { entity_id: "sensor.sierra_blanca_energia_consumida_a", origen: "reading", recorded_at: "2026-10-26T22:45:00+01:00", contador: 924.90 },
    { entity_id: "sensor.sierra_blanca_energia_consumida_a", origen: "reading", recorded_at: "2026-10-26T23:00:00+01:00", contador: 924.91 },
    { entity_id: "sensor.sierra_blanca_energia_consumida_b", origen: "reading", recorded_at: "2026-10-26T22:45:00+01:00", contador: 650.62 },
    { entity_id: "sensor.sierra_blanca_energia_consumida_b", origen: "reading", recorded_at: "2026-10-26T23:00:00+01:00", contador: 651.02 },
  ]);
  const result = await consumoDiarioPorPlanta(db, "2026-10-26", "2026-10-26");
  assert.deepEqual(result.dias, ["2026-10-26"]);
  assert.deepEqual(result.plantaBaja, [0.01]);
  assert.deepEqual(result.plantaAlta, [0.4]);
  assert.deepEqual(result.totales, { baja: 0.01, alta: 0.4, total: 0.41 });
  assert.deepEqual(result.diasIncompletos, []);
  assert.match(db.call.sql, /siguientes AS/);
});

test("incluye todos los días del rango y marca como incompleto un día sin datos", async () => {
  const db = mockDb([]);
  const result = await consumoDiarioPorPlanta(db, "2026-10-26", "2026-10-27");
  assert.deepEqual(result.dias, ["2026-10-26", "2026-10-27"]);
  assert.deepEqual(result.plantaBaja, [0, 0]);
  assert.deepEqual(result.plantaAlta, [0, 0]);
  assert.deepEqual(result.diasIncompletos, ["2026-10-26", "2026-10-27"]);
  assert.deepEqual(result.totales, { baja: 0, alta: 0, total: 0 });
});

test("consumo total calcula deltas y deja a cero la planta sin registros", async () => {
  const db = mockDb([
    { entity_id: "sensor.sierra_blanca_energia_consumida_b", origen: "statistics", recorded_at: "2026-10-01T22:00:00Z", contador: 20 },
    { entity_id: "sensor.sierra_blanca_energia_consumida_b", origen: "statistics", recorded_at: "2026-10-02T22:00:00Z", contador: 32.349 },
  ]);
  assert.deepEqual(await consumoTotalPorPlanta(db, "2026-10-02", "2026-10-02"), { baja: 0, alta: 12.35 });
});
