const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Reparte el importe total de la factura entre Planta Baja y Planta Alta,
 * proporcionalmente a lo que cada una consumió de verdad según sus
 * sensores - no a partes iguales.
 *
 * Como la factura es de toda la casa y los sensores solo cubren las dos
 * plantas, normalmente sobra o falta algo de kWh (zonas comunes,
 * pequeñas diferencias de medición). Ese resto se muestra aparte, nunca
 * se reparte a ciegas entre las dos plantas.
 *
 * Caso raro pero posible: que tus sensores sumen MÁS que lo facturado
 * por la compañía (diferencia de calibración). En ese caso no hay "resto
 * negativo" que tenga sentido mostrar - se reparte solo entre las dos
 * plantas, proporcionalmente entre ellas, y se avisa explícitamente.
 */
function repartirFactura(datosFactura, medido) {
  const { kWhFacturado, totalFactura } = datosFactura;
  const sumaMedida = round2(medido.baja + medido.alta);

  let shareBaja, shareAlta, shareComun, aviso = null;

  if (kWhFacturado > 0 && sumaMedida <= kWhFacturado) {
    shareBaja = medido.baja / kWhFacturado;
    shareAlta = medido.alta / kWhFacturado;
    shareComun = Math.max(0, 1 - shareBaja - shareAlta);
  } else if (sumaMedida > 0) {
    shareBaja = medido.baja / sumaMedida;
    shareAlta = medido.alta / sumaMedida;
    shareComun = 0;
    aviso =
      `Tus sensores registraron ${sumaMedida} kWh, más que los ${kWhFacturado} kWh ` +
      `facturados por la compañía. Se ha repartido el importe solo entre las dos ` +
      `plantas, proporcionalmente entre ellas (sin zona común).`;
  } else {
    shareBaja = 0;
    shareAlta = 0;
    shareComun = 1;
    aviso = "No hay lecturas registradas de ninguna planta en este periodo.";
  }

  return {
    plantaBaja: {
      kWh: medido.baja,
      euros: round2(totalFactura * shareBaja),
      porcentaje: round2(shareBaja * 100),
    },
    plantaAlta: {
      kWh: medido.alta,
      euros: round2(totalFactura * shareAlta),
      porcentaje: round2(shareAlta * 100),
    },
    sinAsignar: {
      kWh: round2(kWhFacturado - sumaMedida),
      euros: round2(totalFactura * shareComun),
      porcentaje: round2(shareComun * 100),
    },
    aviso,
  };
}

module.exports = { repartirFactura };
