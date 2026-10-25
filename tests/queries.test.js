const test = require("node:test");
const assert = require("node:assert/strict");
const { consumoDiarioPorPlanta, consumoTotalPorPlanta } = require("../src/queries");

test("consumo diario lee de historical_data y devuelve totales por planta", async () => {
  let call;
  const db = {
    async execute(args) {
      call = args;
      return { rows: [
        { entity_id: "sensor.sierra_blanca_energia_consumida_a", dia: "2026-10-24", consumo: 2.345 },
        { entity_id: "sensor.sierra_blanca_energia_consumida_b", dia: "2026-10-24", consumo: 4.567 },
        { entity_id: "sensor.sierra_blanca_energia_consumida_a", dia: "2026-10-25", consumo: 1.1 },
      ] };
    },
  };

  const result = await consumoDiarioPorPlanta(db, "2026-10-24", "2026-10-25");
  assert.match(call.sql, /FROM historical_data/);
  assert.match(call.sql, /record_type = 'reading'/);
  assert.deepEqual(call.args.slice(-2), ["2026-10-24", "2026-10-25"]);
  assert.deepEqual(result.dias, ["2026-10-24", "2026-10-25"]);
  assert.deepEqual(result.plantaBaja, [2.35, 1.1]);
  assert.deepEqual(result.plantaAlta, [4.57, 0]);
  assert.deepEqual(result.totales, { baja: 3.45, alta: 4.57, total: 8.02 });
});

test("consumo total lee del histórico unificado y conserva plantas sin filas a cero", async () => {
  let call;
  const db = {
    async execute(args) {
      call = args;
      return { rows: [
        { entity_id: "sensor.sierra_blanca_energia_consumida_b", consumo: 12.349 },
      ] };
    },
  };

  const result = await consumoTotalPorPlanta(db, "2026-10-01", "2026-10-25");
  assert.match(call.sql, /FROM historical_data/);
  assert.match(call.sql, /record_type = 'reading'/);
  assert.deepEqual(call.args.slice(-2), ["2026-10-01", "2026-10-25"]);
  assert.deepEqual(result, { baja: 0, alta: 12.35 });
});
