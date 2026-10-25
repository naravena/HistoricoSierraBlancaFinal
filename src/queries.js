const ENTITY_BAJA = "sensor.sierra_blanca_energia_consumida_a";
const ENTITY_ALTA = "sensor.sierra_blanca_energia_consumida_b";

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Consumo diario de ambas plantas.
 *
 * IMPORTANTE: el LAG se calcula usando también la lectura inmediatamente
 * anterior al inicio del periodo. La versión anterior calculaba LAG solo
 * dentro del rango solicitado, por lo que la primera lectura de cada planta
 * siempre quedaba sin delta y se perdía consumo.
 */
async function consumoDiarioPorPlanta(pool, desde, hasta) {
  const { rows } = await pool.query(
    `
    with ordenado as (
      select entity_id, recorded_at, value,
             lag(value) over (partition by entity_id order by recorded_at) as anterior
      from readings
      where entity_id = any($1)
        and recorded_at < $3
    ),
    deltas as (
      select entity_id, recorded_at,
             greatest(value - anterior, 0) as consumo
      from ordenado
      where anterior is not null
        and recorded_at >= $2
    )
    select entity_id,
           date_trunc('day', recorded_at)::date as dia,
           sum(consumo) as consumo
    from deltas
    group by entity_id, dia
    order by dia
    `,
    [[ENTITY_BAJA, ENTITY_ALTA], desde, hasta]
  );

  const porDia = new Map();
  for (const r of rows) {
    const dia = r.dia.toISOString().slice(0, 10);
    if (!porDia.has(dia)) porDia.set(dia, { baja: 0, alta: 0 });
    const valor = Number(r.consumo);
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

/**
 * Consumo total de cada planta entre dos fechas.
 *
 * También incluye la lectura anterior al inicio del periodo para no perder
 * el primer incremento.
 */
async function consumoTotalPorPlanta(pool, desde, hastaExclusiva) {
  const { rows } = await pool.query(
    `
    with ordenado as (
      select entity_id, recorded_at, value,
             lag(value) over (partition by entity_id order by recorded_at) as anterior
      from readings
      where entity_id = any($1)
        and recorded_at < $3
    )
    select entity_id,
           sum(greatest(value - anterior, 0)) as consumo
    from ordenado
    where anterior is not null
      and recorded_at >= $2
    group by entity_id
    `,
    [[ENTITY_BAJA, ENTITY_ALTA], desde, hastaExclusiva]
  );

  const resultado = { baja: 0, alta: 0 };
  for (const r of rows) {
    if (r.entity_id === ENTITY_BAJA) resultado.baja = round2(Number(r.consumo));
    else if (r.entity_id === ENTITY_ALTA) resultado.alta = round2(Number(r.consumo));
  }
  return resultado;
}

module.exports = { consumoDiarioPorPlanta, consumoTotalPorPlanta };
