function endpoints() {
  const parts = location.pathname.split("/");
  if (parts[1] === "interaction" && parts[2]) {
    return {
      challenge: `/interaction/${parts[2]}/challenge`,
      wallet: `/interaction/${parts[2]}/wallet`,
      token: `/interaction/${parts[2]}/token`,
    };
  }
  const next = new URLSearchParams(location.search).get("next") || "/console";
  return {
    challenge: "/login/challenge",
    wallet: "/login/wallet",
    token: "/login/token",
    next,
  };
}

function extractToken(data) {
  if (!data) return null;
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (!trimmed) return null;
    try {
      return extractToken(JSON.parse(trimmed));
    } catch {
      return trimmed.length > 16 ? trimmed : null;
    }
  }
  if (typeof data !== "object") return null;
  const record = data;
  return (
    extractToken(record.token) ||
    extractToken(record.jwt) ||
    extractToken(record.accessToken) ||
    extractToken(record.access_token) ||
    (record.name === "tokenTwetchAuth" ? extractToken(record.data) : null) ||
    (record.type === "emit" ? extractToken(record.data) : null) ||
    extractToken(record.value) ||
    extractToken(record.payload)
  );
}

async function loadChallenge() {
  const { challenge } = endpoints();
  const status = document.getElementById("wallet-status");
  const text = document.getElementById("challenge-text");
  if (!status || !text) return;
  status.textContent = "Requesting challenge…";
  const res = await fetch(challenge);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Could not load challenge." }));
    status.textContent = body.error || "Could not load challenge.";
    return;
  }
  const data = await res.json();
  text.textContent = data.message;
  text.dataset.challengeId = data.id;
  status.textContent =
    data.source === "twetch"
      ? "Sign this challenge, then paste the signature."
      : "Sign this message with your Bitcoin wallet, then paste the signature.";
}

async function walletLogin() {
  const { wallet, next } = endpoints();
  const status = document.getElementById("wallet-status");
  const text = document.getElementById("challenge-text");
  const address = document.getElementById("address")?.value.trim();
  const signature = document.getElementById("signature")?.value.trim();
  const algorithm = document.getElementById("algorithm")?.value?.trim();
  const challengeId = text?.dataset.challengeId;
  if (!status) return;
  if (!challengeId) {
    status.textContent = "Load a challenge first.";
    return;
  }
  status.textContent = "Verifying with Twetch…";
  const res = await fetch(wallet, {
    method: "POST",
    headers: { "content-type": "application/json" },
    redirect: "manual",
    body: JSON.stringify({ challengeId, address, signature, algorithm, next }),
  });
  if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
    window.location.href = res.headers.get("location");
    return;
  }
  const body = await res.json().catch(() => ({}));
  if (res.ok && body.redirect) {
    window.location.href = body.redirect;
    return;
  }
  if (res.ok) {
    window.location.reload();
    return;
  }
  status.textContent = body.error || "Login failed";
}

async function continueWithToken(token) {
  const { token: tokenPath, next } = endpoints();
  const res = await fetch(tokenPath, {
    method: "POST",
    headers: { "content-type": "application/json" },
    redirect: "manual",
    body: JSON.stringify({ token, next }),
  });
  if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
    window.location.href = res.headers.get("location");
    return;
  }
  const body = await res.json().catch(() => ({}));
  if (res.ok && body.redirect) {
    window.location.href = body.redirect;
    return;
  }
  if (res.ok) {
    window.location.reload();
    return;
  }
  const status = document.getElementById("wallet-status");
  if (status) status.textContent = body.error || "Token login failed";
}

document.getElementById("load-challenge")?.addEventListener("click", () => {
  loadChallenge().catch((err) => {
    const status = document.getElementById("wallet-status");
    if (status) status.textContent = String(err);
  });
});

document.getElementById("wallet-login")?.addEventListener("click", () => {
  walletLogin().catch((err) => {
    const status = document.getElementById("wallet-status");
    if (status) status.textContent = String(err);
  });
});

window.addEventListener("message", (event) => {
  const token = extractToken(event.data);
  if (!token) return;
  continueWithToken(token).catch(() => {});
});