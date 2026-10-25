/**
 * Parser robusto para facturas Repsol.
 *
 * pdf-parse/pdf.js no garantiza conservar el layout visual del PDF: textos
 * que en pantalla están en columnas pueden aparecer concatenados o con saltos
 * de línea inesperados. Por eso normalizamos el texto y usamos patrones
 * tolerantes al espacio, pero seguimos exigiendo los datos necesarios.
 */

function parseNumeroEs(str) {
  if (str == null || String(str).trim() === "") return null;
  return parseFloat(String(str).replace(/\./g, "").replace(",", "."));
}

function fechaEsAIso(fechaDDMMYYYY) {
  const [d, m, y] = fechaDDMMYYYY.split("/");
  return `${y}-${m}-${d}`;
}

function normalizarTexto(texto) {
  return String(texto || "")
    .replace(/\u00a0/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizarSinAcentos(texto) {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function primerMatch(texto, patrones) {
  for (const patron of patrones) {
    const m = texto.match(patron);
    if (m) return m;
  }
  return null;
}

function extraerDatosFactura(textoOriginal) {
  const texto = normalizarTexto(textoOriginal);
  const sinAcentos = normalizarSinAcentos(texto);
  const errores = [];

  // 1. Periodo. Se acepta el formato habitual de Repsol y variaciones de
  // espacios alrededor del guion.
  const mPeriodo = primerMatch(sinAcentos, [
    /Periodo\s+de\s+facturacion\s*:?\s*(\d{2}\/\d{2}\/\d{4})\s*[-–—]\s*(\d{2}\/\d{2}\/\d{4})/i,
    /periodo\s+de\s+facturacion[\s\S]{0,80}?(\d{2}\/\d{2}\/\d{4})\s*[-–—]\s*(\d{2}\/\d{2}\/\d{4})/i,
  ]);
  if (!mPeriodo) errores.push("periodo de facturación");

  // 2. Consumo total. El texto puede contener "Consumo en este periodo"
  // seguido de columnas/elementos antes del número.
  const mConsumo = primerMatch(sinAcentos, [
    /Consumo\s+en\s+este\s+periodo\s*:?\s*([\d.,]+)\s*kWh/i,
    /Consumo\s+en\s+este\s+periodo[\s\S]{0,120}?([\d.,]+)\s*kWh/i,
  ]);
  if (!mConsumo) errores.push("consumo del periodo (kWh)");

  // 3. Total de factura.
  const mTotal = primerMatch(sinAcentos, [
    /Total\s+factura\s*:?\s*([\d.,]+)\s*€/i,
    /Total\s+factura[\s\S]{0,80}?([\d.,]+)\s*€/i,
  ]);
  if (!mTotal) errores.push("total factura");

  // 4. Precio de energía. No dependemos de que "Consumo (P1)" y el cálculo
  // estén juntos. En la factura aparece literalmente:
  // 448,36 kWh x 0,1099 €/kWh
  const mPrecioEnergia = primerMatch(sinAcentos, [
    /([\d.,]+)\s*kWh\s*x\s*([\d.,]+)\s*€\s*\/\s*kWh/i,
    /([\d.,]+)\s*kWh\s*[×x]\s*([\d.,]+)\s*€\s*por\s*kWh/i,
  ]);
  if (!mPrecioEnergia) errores.push("precio de energía (€/kWh)");

  if (errores.length) {
    const err = new Error(
      `No se pudieron leer estos datos de la factura: ${errores.join(", ")}. ` +
      `La aplicación ha recibido un PDF cuya extracción de texto no coincide con los patrones esperados.`
    );
    err.status = 422;
    // No exponemos el PDF completo, pero dejamos una pequeña muestra en logs
    // para poder diagnosticar futuras facturas con cambios de formato.
    err.debug = {
      textoLength: texto.length,
      muestra: texto.slice(0, 1200),
    };
    throw err;
  }

  const kWhFacturado = parseNumeroEs(mConsumo[1]);
  const totalFactura = parseNumeroEs(mTotal[1]);
  const consumoEnergia = parseNumeroEs(mPrecioEnergia[1]);
  const precioEnergiaKWh = parseNumeroEs(mPrecioEnergia[2]);

  // Validación cruzada: el cálculo impreso por Repsol debe corresponder al
  // consumo facturado. Si no coincide, no rompemos la importación; avisamos.
  const diferenciaConsumo = Math.abs(consumoEnergia - kWhFacturado);
  const avisoConsumo = diferenciaConsumo > 0.02
    ? `El consumo del cálculo de energía (${consumoEnergia} kWh) no coincide exactamente con el consumo facturado (${kWhFacturado} kWh).`
    : null;

  const mTerminoFijo = sinAcentos.match(/Termino\s+fijo\s+([\d.,]+)\s*€/i);
  const mEnergia = sinAcentos.match(/Energia\s+([\d.,]+)\s*€/i);
  const mOtros = sinAcentos.match(/Otros\s+conceptos\s+([\d.,]+)\s*€/i);
  const mImpuestos = sinAcentos.match(/Impuestos\s+([\d.,]+)\s*€/i);

  return {
    desde: fechaEsAIso(mPeriodo[1]),
    hasta: fechaEsAIso(mPeriodo[2]),
    kWhFacturado,
    totalFactura,
    precioEnergiaKWh,
    importeEnergia: consumoEnergia * precioEnergiaKWh,
    precioEfectivoFacturaKWh:
      kWhFacturado > 0 ? Math.round((totalFactura / kWhFacturado) * 10000) / 10000 : null,
    resumen: {
      terminoFijo: mTerminoFijo ? parseNumeroEs(mTerminoFijo[1]) : null,
      energia: mEnergia ? parseNumeroEs(mEnergia[1]) : null,
      otrosConceptos: mOtros ? parseNumeroEs(mOtros[1]) : null,
      impuestos: mImpuestos ? parseNumeroEs(mImpuestos[1]) : null,
    },
    avisoConsumo,
  };
}

module.exports = { extraerDatosFactura, parseNumeroEs, normalizarTexto };
