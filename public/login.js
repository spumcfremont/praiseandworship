(() => {
  const form = document.getElementById("login");
  const err = document.getElementById("err");
  const btn = form.querySelector("button");

  function nextUrl() {
    const next = new URLSearchParams(location.search).get("next") || "/";
    return next.startsWith("/") && !next.startsWith("//") ? next : "/";
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.hidden = true;
    btn.disabled = true;
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: form.password.value }),
      });
      if (res.ok) return location.replace(nextUrl());
      const data = await res.json().catch(() => ({}));
      err.textContent = res.status === 429 ? "Too many tries. Wait a minute and try again." : data.error || "That password didn't work.";
      err.hidden = false;
      form.password.select();
    } catch {
      err.textContent = "Couldn't reach the server. Check your connection.";
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });
})();
