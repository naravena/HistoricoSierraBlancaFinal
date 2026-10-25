fetch("/api/auth/me", { credentials: "include" }).then((r) => {
  if (r.ok) window.location.href = "/index.html";
});

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorBox = document.getElementById("error");
  errorBox.hidden = true;

  const boton = e.target.querySelector("button");
  boton.disabled = true;
  boton.textContent = "Entrando…";

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: document.getElementById("password").value }),
    });
    const data = await res.json();

    if (!res.ok) {
      errorBox.textContent = data.error || "No se pudo iniciar sesión";
      errorBox.hidden = false;
      return;
    }
    window.location.href = "/index.html";
  } catch {
    errorBox.textContent = "No se pudo conectar con el servidor";
    errorBox.hidden = false;
  } finally {
    boton.disabled = false;
    boton.textContent = "Entrar";
  }
});
