const ENTITY_BAJA = "sensor.sierra_blanca_energia_consumida_a";
const ENTITY_ALTA = "sensor.sierra_blanca_energia_consumida_b";
const round2 = (n) => Math.round(n * 100) / 100;

/*
 * El portal consulta exclusivamente historical_data.
 * Las fechas de la interfaz son inclusivas (incluyen el día "hasta").
 * julianday() ordena correctamente timestamps que incluyen Z o distintos
 * offsets; ordenar el texto directamente puede colocar lecturas fuera de orden.
 */
async function consumoDiarioPorPlanta(db, desde, hasta) {
  const { rows } = await db.execute({
    sql: `
      WITH ordenado AS (
        SELECT entity_id, recorded_at, value,
               LAG(value) OVER (
                 PARTITION BY entity_id
                 ORDER BY julianday(recorded_at), recorded_at, source_row_id
               ) AS anterior
        FROM historical_data
        WHERE record_type = 'reading'
          AND entity_id IN (?, ?)
          AND julianday(recorded_at) < julianday(date(?, '+1 day'))
      ),
      deltas AS (
        SELECT entity_id, recorded_at,
               MAX(value - anterior, 0) AS consumo
        FROM ordenado
        WHERE anterior IS NOT NULL
          AND date(recorded_at) >= date(?)
          AND date(recorded_at) <= date(?)
      )
      SELECT entity_id, date(recorded_at) AS dia, SUM(consumo) AS consumo
      FROM deltas
      GROUP BY entity_id, date(recorded_at)
      ORDER BY dia
    `,
    args: [ENTITY_BAJA, ENTITY_ALTA, hasta, desde, hasta],
  });

  const porDia = new Map();
  for (const r of rows) {
    const dia = String(r.dia).slice(0, 10);
    if (!porDia.has(dia)) porDia.set(dia, { baja: 0, alta: 0 });
    const valor = Number(r.consumo || 0);
    if (r.entity_id === ENTITY_BAJA) porDia.get(dia).baja = valor;
    else if (r.entity_id === ENTITY_ALTA) porDia.get(dia).alta = valor;
  }

  const dias = [...porDia.keys()].sort();
  const plantaBaja = dias.map((d) => round2(porDia.get(d).baja));
  const plantaAlta = dias.map((d) => round2(porDia.get(d).alta));
  const totalBaja = round2(plantaBaja.reduce((a, b) => a + b, 0));
  const totalAlta = round2(plantaAlta.reduce((a, b) => a + b, 0));

  return {
    dias,
    plantaBaja,
    plantaAlta,
    totales: {
      baja: totalBaja,
      alta: totalAlta,
      total: round2(totalBaja + totalAlta),
    },
  };
}

async function consumoTotalPorPlanta(db, desde, hasta) {
  const { rows } = await db.execute({
    sql: `
      WITH ordenado AS (
        SELECT entity_id, recorded_at, value,
               LAG(value) OVER (
                 PARTITION BY entity_id
                 ORDER BY julianday(recorded_at), recorded_at, source_row_id
               ) AS anterior
        FROM historical_data
        WHERE record_type = 'reading'
          AND entity_id IN (?, ?)
          AND julianday(recorded_at) < julianday(date(?, '+1 day'))
      )
      SELECT entity_id, SUM(MAX(value - anterior, 0)) AS consumo
      FROM ordenado
      WHERE anterior IS NOT NULL
        AND date(recorded_at) >= date(?)
        AND date(recorded_at) <= date(?)
      GROUP BY entity_id
    `,
    args: [ENTITY_BAJA, ENTITY_ALTA, hasta, desde, hasta],
  });

  const resultado = { baja: 0, alta: 0 };
  for (const r of rows) {
    if (r.entity_id === ENTITY_BAJA) resultado.baja = round2(Number(r.consumo || 0));
    else if (r.entity_id === ENTITY_ALTA) resultado.alta = round2(Number(r.consumo || 0));
  }
  return resultado;
}

module.exports = { consumoDiarioPorPlanta, consumoTotalPorPlanta };
