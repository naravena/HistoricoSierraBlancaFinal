const ENTITY_BAJA = "sensor.sierra_blanca_energia_consumida_a";
const ENTITY_ALTA = "sensor.sierra_blanca_energia_consumida_b";
const ENTITIES = [ENTITY_BAJA, ENTITY_ALTA];
const round2 = (n) => Math.round(n * 100) / 100;

/*
 * Usa estadísticas históricas cuando existen para un sensor y un día
 * (sum acumulado); usa lecturas para días sin estadísticas. Así no suma
 * ambos orígenes para el mismo día.
 *
 * Las fechas de la interfaz son inclusivas. Los timestamps se agrupan por
 * fecha UTC como están almacenados; la cobertura incompleta se informa para
 * que un día con huecos no se presente como un total cerrado.
 */
async function consultarConsumo(db, desde, hasta) {
  return db.execute({
    sql: `
      WITH registros AS (
        SELECT entity_id, recorded_at, value AS contador, 'reading' AS origen
        FROM historical_data
        WHERE record_type = 'reading'
          AND entity_id IN (?, ?)
          AND julianday(recorded_at) < julianday(date(?, '+1 day'))
        UNION ALL
        SELECT entity_id, recorded_at, sum AS contador, 'statistics' AS origen
        FROM historical_data
        WHERE record_type = 'statistics'
          AND entity_id IN (?, ?)
          AND sum IS NOT NULL
          AND julianday(recorded_at) < julianday(date(?, '+1 day'))
      ),
      ordenado AS (
        SELECT entity_id, recorded_at, date(recorded_at) AS dia, contador, origen,
          LAG(contador) OVER (
            PARTITION BY entity_id, origen
            ORDER BY julianday(recorded_at), recorded_at
          ) AS anterior
        FROM registros
      ),
      deltas AS (
        SELECT entity_id, dia, origen,
          SUM(CASE WHEN anterior IS NOT NULL AND contador >= anterior
                   THEN contador - anterior ELSE 0 END) AS consumo
        FROM ordenado
        WHERE date(recorded_at) >= date(?)
          AND date(recorded_at) <= date(?)
        GROUP BY entity_id, dia, origen
      ),
      dias_con_stats AS (
        SELECT DISTINCT entity_id, dia
        FROM deltas
        WHERE origen = 'statistics'
      ),
      elegidos AS (
        SELECT d.entity_id, d.dia, d.consumo
        FROM deltas d
        WHERE d.origen = 'statistics'
           OR (d.origen = 'reading' AND NOT EXISTS (
             SELECT 1 FROM dias_con_stats s
             WHERE s.entity_id = d.entity_id AND s.dia = d.dia
           ))
      ),
      consumo AS (
        SELECT entity_id, dia, SUM(consumo) AS consumo
        FROM elegidos
        GROUP BY entity_id, dia
      ),
      cobertura AS (
        SELECT entity_id, date(recorded_at) AS dia, MAX(julianday(recorded_at)) AS ultimo
        FROM registros
        WHERE date(recorded_at) >= date(?)
          AND date(recorded_at) <= date(?)
        GROUP BY entity_id, date(recorded_at)
      )
      SELECT c.entity_id, c.dia, c.consumo,
        CASE WHEN julianday(date(c.dia, '+1 day')) - cov.ultimo > (1.0 / 24.0)
             THEN 1 ELSE 0 END AS incompleto
      FROM consumo c
      LEFT JOIN cobertura cov ON cov.entity_id = c.entity_id AND cov.dia = c.dia
      ORDER BY c.dia, c.entity_id
    `,
    args: [ENTITY_BAJA, ENTITY_ALTA, hasta, ENTITY_BAJA, ENTITY_ALTA, hasta, desde, hasta, desde, hasta],
  });
}

async function consumoDiarioPorPlanta(db, desde, hasta) {
  const { rows } = await consultarConsumo(db, desde, hasta);
  const porDia = new Map();
  for (const r of rows) {
    const dia = String(r.dia).slice(0, 10);
    if (!porDia.has(dia)) porDia.set(dia, { baja: 0, alta: 0, incompleto: false });
    const valor = Number(r.consumo || 0);
    if (r.entity_id === ENTITY_BAJA) porDia.get(dia).baja = valor;
    else if (r.entity_id === ENTITY_ALTA) porDia.get(dia).alta = valor;
    if (Number(r.incompleto) === 1) porDia.get(dia).incompleto = true;
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
    diasIncompletos: dias.map((d) => porDia.get(d).incompleto ? d : null).filter(Boolean),
    totales: { baja: totalBaja, alta: totalAlta, total: round2(totalBaja + totalAlta) },
  };
}

async function consumoTotalPorPlanta(db, desde, hasta) {
  const { rows } = await consultarConsumo(db, desde, hasta);
  const resultado = { baja: 0, alta: 0 };
  for (const r of rows) {
    if (r.entity_id === ENTITY_BAJA) resultado.baja += Number(r.consumo || 0);
    else if (r.entity_id === ENTITY_ALTA) resultado.alta += Number(r.consumo || 0);
  }
  return { baja: round2(resultado.baja), alta: round2(resultado.alta) };
}

module.exports = { consumoDiarioPorPlanta, consumoTotalPorPlanta };
