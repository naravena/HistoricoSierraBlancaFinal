let chart = null;

async function comprobarSesion() {
  const res = await fetch("/api/auth/me", { credentials: "include" });
  if (!res.ok) window.location.href = "/login.html";
}

document.getElementById("btn-logout").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  window.location.href = "/login.html";
});

function fechaLocalISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function rangoPorDefecto() {
  const hoy = new Date();
  const hace30 = new Date(hoy);
  hace30.setDate(hoy.getDate() - 30);
  // No usar toISOString(): convierte a UTC y puede seleccionar el día anterior
  // en España cuando el navegador está en una zona horaria positiva.
  document.getElementById("hasta").value = fechaLocalISO(hoy);
  document.getElementById("desde").value = fechaLocalISO(hace30);
}

async function consultar() {
  const desde = document.getElementById("desde").value;
  const hasta = document.getElementById("hasta").value;
  if (!desde || !hasta) return;
  if (desde > hasta) return alert("La fecha inicial no puede ser posterior a la final.");

  const boton = document.getElementById("btn-consultar");
  boton.disabled = true;
  boton.textContent = "Cargando…";

  try {
    const res = await fetch(`/api/consumo?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`, { credentials: "include" });
    if (res.status === 401) return (window.location.href = "/login.html");
    const datos = await res.json();
    if (!res.ok) throw new Error(datos.error || "Error al consultar");

    document.getElementById("val-baja").textContent = `${datos.totales.baja} kWh`;
    document.getElementById("val-alta").textContent = `${datos.totales.alta} kWh`;
    document.getElementById("val-total").textContent = `${datos.totales.total} kWh`;

    let avisoCobertura = document.getElementById("aviso-cobertura");
    if (!avisoCobertura) {
      avisoCobertura = document.createElement("p");
      avisoCobertura.id = "aviso-cobertura";
      avisoCobertura.className = "aviso-box";
      document.querySelector(".chart-panel").before(avisoCobertura);
    }
    const incompletos = datos.diasIncompletos || [];
    if (incompletos.length) {
      avisoCobertura.hidden = false;
      avisoCobertura.textContent = `⚠️ Datos parciales o con huecos en: ${incompletos.join(", ")}. El consumo mostrado corresponde a los registros disponibles, no necesariamente al día completo.`;
    } else {
      avisoCobertura.hidden = true;
      avisoCobertura.textContent = "";
    }

    dibujarGrafica(datos);
  } catch (err) {
    alert(err.message);
  } finally {
    boton.disabled = false;
    boton.textContent = "Consultar";
  }
}

function dibujarGrafica(datos) {
  if (chart) chart.destroy();
  const ctx = document.getElementById("chart");

  chart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: datos.dias,
      datasets: [
        { label: "Planta Baja", data: datos.plantaBaja, backgroundColor: "#4fa3d1" },
        { label: "Planta Alta", data: datos.plantaAlta, backgroundColor: "#7fd8b8" },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "top", labels: { color: "#e7ebee" } } },
      scales: {
        x: { grid: { color: "#2b3540" }, ticks: { color: "#8b96a1" } },
        y: { grid: { color: "#2b3540" }, ticks: { color: "#8b96a1" }, title: { display: true, text: "kWh", color: "#8b96a1" } },
      },
    },
  });
}

document.getElementById("btn-consultar").addEventListener("click", consultar);

/* ---------- Reparto de factura ---------- */
async function analizarFactura() {
  const input = document.getElementById("factura-pdf");
  const archivo = input.files[0];
  if (!archivo) return alert("Selecciona primero el PDF de la factura.");

  const boton = document.getElementById("btn-analizar-factura");
  boton.disabled = true;
  boton.textContent = "Analizando…";

  const formData = new FormData();
  formData.append("factura", archivo);

  try {
    const res = await fetch("/api/factura/analizar", {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    if (res.status === 401) return (window.location.href = "/login.html");

    const datos = await res.json();
    if (!res.ok) throw new Error(datos.error || "No se pudo analizar la factura");

    renderizarReparto(datos);
  } catch (err) {
    alert(err.message);
  } finally {
    boton.disabled = false;
    boton.textContent = "Analizar factura";
  }
}

function renderizarReparto({ factura, reparto }) {
  const contenedor = document.getElementById("resultado-factura");

  const aviso = reparto.aviso
    ? `<div class="aviso-box">⚠️ ${reparto.aviso}</div>`
    : "";

  contenedor.innerHTML = `
    ${aviso}
    ${factura.avisoConsumo ? `<div class="aviso-box">⚠️ ${factura.avisoConsumo}</div>` : ""}
    <div class="factura-resumen">
      Periodo: <strong>${factura.desde}</strong> → <strong>${factura.hasta}</strong> ·
      Total factura: <strong>${factura.totalFactura.toFixed(2)} €</strong> ·
      Consumo facturado: <strong>${factura.kWhFacturado} kWh</strong> ·
      Energía: <strong>${factura.precioEnergiaKWh.toFixed(4)} €/kWh</strong> ·
      Coste efectivo factura: <strong>${factura.precioEfectivoFacturaKWh.toFixed(4)} €/kWh</strong>
    </div>
    <div class="cards">
      <div class="card baja">
        <div class="lbl">Planta Baja (${reparto.plantaBaja.porcentaje}%)</div>
        <div class="val">${reparto.plantaBaja.euros.toFixed(2)} €</div>
        <div class="muted">${reparto.plantaBaja.kWh} kWh</div>
      </div>
      <div class="card alta">
        <div class="lbl">Planta Alta (${reparto.plantaAlta.porcentaje}%)</div>
        <div class="val">${reparto.plantaAlta.euros.toFixed(2)} €</div>
        <div class="muted">${reparto.plantaAlta.kWh} kWh</div>
      </div>
      <div class="card comun">
        <div class="lbl">Sin asignar (${reparto.sinAsignar.porcentaje}%)</div>
        <div class="val">${reparto.sinAsignar.euros.toFixed(2)} €</div>
        <div class="muted">${reparto.sinAsignar.kWh} kWh — zonas comunes / diferencia de medición</div>
      </div>
    </div>
  `;
}

document.getElementById("btn-analizar-factura").addEventListener("click", analizarFactura);

comprobarSesion().then(() => {
  rangoPorDefecto();
  consultar();
});
