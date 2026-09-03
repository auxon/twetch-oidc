/// <reference lib="dom" />
import { deriveTwetchAccounts, wipeBytes } from "../auth/twetch-seed.ts";
import { signMessage } from "../auth/bitcoin.ts";

interface SeedChallenge {
  id: string;
  message: string;
}

interface SeedLoginResponse {
  redirect?: string;
  error?: string;
}

function seedEndpoints() {
  const parts = location.pathname.split("/");
  if (parts[1] === "interaction" && parts[2]) {
    return {
      challenge: `/interaction/${parts[2]}/seed-challenge`,
      login: `/interaction/${parts[2]}/seed`,
    };
  }
  const next = new URLSearchParams(location.search).get("next") || "/console";
  return {
    challenge: "/login/seed-challenge",
    login: "/login/seed",
    next,
  };
}

function setStatus(message: string) {
  const status = document.getElementById("seed-status");
  if (status) status.textContent = message;
}

async function seedLogin() {
  const field = document.getElementById("seed-phrase") as HTMLTextAreaElement | null;
  const raw = field?.value ?? "";
  if (field) field.value = "";
  if (!raw.trim()) {
    setStatus("Enter your Twetch seed phrase.");
    return;
  }
  setStatus("Deriving keys in this browser…");
  let accounts;
  try {
    accounts = deriveTwetchAccounts(raw);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : "That seed phrase is not valid.");
    return;
  }

  const { challenge, login, next } = seedEndpoints();
  let lastError = "Twetch has no identity key for this seed.";
  for (const account of accounts) {
    try {
      const challengeRes = await fetch(challenge);
      const challengeBody = (await challengeRes
        .json()
        .catch(() => ({}))) as Partial<SeedChallenge>;
      if (!challengeRes.ok || !challengeBody.id || !challengeBody.message) {
        lastError =
          (challengeBody as { error?: string }).error || "Could not load a challenge.";
        continue;
      }
      const signature = signMessage(challengeBody.message, account.secretKey);
      wipeBytes(account.secretKey);
      setStatus("Verifying with Twetch…");
      const res = await fetch(login, {
        method: "POST",
        headers: { "content-type": "application/json" },
        redirect: "manual",
        body: JSON.stringify({
          challengeId: challengeBody.id,
          signature,
          publicKey: account.publicKeyHex,
          next,
        }),
      });
      // Preferred: server answers 200 + { redirect } (JSON survives fetch in
      // every browser; 303 Location headers do not).
      const body = (await res
        .clone()
        .json()
        .catch(() => ({}))) as SeedLoginResponse;
      if (res.ok && typeof body.redirect === "string" && body.redirect) {
        window.location.href = body.redirect;
        return;
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        window.location.href = res.headers.get("location")!;
        return;
      }
      if (res.ok) {
        window.location.reload();
        return;
      }
      lastError = body.error || lastError;
    } catch (err) {
      lastError = err instanceof Error ? err.message : lastError;
    }
  }
  setStatus(lastError);
}

document.getElementById("seed-login")?.addEventListener("click", () => {
  seedLogin().catch((err) => setStatus(String(err)));
});

document.getElementById("seed-phrase")?.addEventListener("keydown", (event) => {
  if (event instanceof KeyboardEvent && event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    seedLogin().catch((err) => setStatus(String(err)));
  }
});
