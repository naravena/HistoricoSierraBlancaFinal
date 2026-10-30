const form = document.getElementById("raw-form");
const output = document.getElementById("resultado");
const status = document.getElementById("estado");
const button = document.getElementById("consultar");

function localISO(date) {
  return [date.getFullYear(), String(date.getMonth()+1).padStart(2,"0"), String(date.getDate()).padStart(2,"0")].join("-");
}
const today = new Date();
const weekAgo = new Date(today);
weekAgo.setDate(today.getDate()-6);
document.getElementById("hasta").value = localISO(today);
document.getElementById("desde").value = localISO(weekAgo);

async function checkSession() {
  const response = await fetch("/api/auth/me", { credentials: "include" });
  if (!response.ok) window.location.href = "/login.html";
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const desde = document.getElementById("desde").value;
  const hasta = document.getElementById("hasta").value;
  if (!desde || !hasta || desde > hasta) {
    status.textContent = "Revisa el intervalo: la fecha inicial debe ser anterior o igual a la final.";
    status.className = "raw-meta raw-error";
    return;
  }
  button.disabled = true;
  button.textContent = "Consultando…";
  status.textContent = "Conectando con Home Assistant…";
  status.className = "raw-meta";
  output.textContent = "";
  try {
    const response = await fetch("/api/ha/raw?" + new URLSearchParams({ desde, hasta }), { credentials: "include" });
    const data = await response.json();
    output.textContent = JSON.stringify(data, null, 2);
    if (!response.ok) throw new Error(data.error || "Error al consultar Home Assistant");
    status.textContent = data.count + " estados recibidos · " + data.desde + " a " + data.hasta + " · " + data.timezone;
  } catch (error) {
    status.textContent = error.message;
    status.className = "raw-meta raw-error";
  } finally {
    button.disabled = false;
    button.textContent = "Consultar Home Assistant";
  }
});
checkSession();