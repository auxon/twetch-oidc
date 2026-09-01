async function loadChallenge() {
  const uid = location.pathname.split("/")[2];
  const status = document.getElementById("wallet-status");
  const text = document.getElementById("challenge-text");
  status.textContent = "Requesting challenge…";
  const res = await fetch(`/interaction/${uid}/challenge`);
  if (!res.ok) {
    status.textContent = "Could not load challenge.";
    return;
  }
  const data = await res.json();
  text.textContent = data.message;
  text.dataset.challengeId = data.id;
  status.textContent = "Sign this message with your Bitcoin wallet, then paste the signature.";
}

async function walletLogin() {
  const uid = location.pathname.split("/")[2];
  const status = document.getElementById("wallet-status");
  const text = document.getElementById("challenge-text");
  const address = document.getElementById("address").value.trim();
  const signature = document.getElementById("signature").value.trim();
  const challengeId = text.dataset.challengeId;
  if (!challengeId) {
    status.textContent = "Load a challenge first.";
    return;
  }
  status.textContent = "Verifying…";
  const res = await fetch(`/interaction/${uid}/wallet`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    redirect: "manual",
    body: JSON.stringify({ challengeId, address, signature }),
  });
  if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
    window.location.href = res.headers.get("location");
    return;
  }
  if (res.ok) {
    window.location.reload();
    return;
  }
  const body = await res.json().catch(() => ({ error: "Login failed" }));
  status.textContent = body.error || "Login failed";
}

document.getElementById("load-challenge")?.addEventListener("click", () => {
  loadChallenge().catch((err) => {
    document.getElementById("wallet-status").textContent = String(err);
  });
});

document.getElementById("wallet-login")?.addEventListener("click", () => {
  walletLogin().catch((err) => {
    document.getElementById("wallet-status").textContent = String(err);
  });
});