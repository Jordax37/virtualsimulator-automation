// Source du bundle admin/callback.js -- traite les liens reçus par email
// (invitation, confirmation, récupération de mot de passe, changement
// d'email). Nécessaire dès l'activation d'Identity en mode Invite only :
// c'est via cette page qu'un utilisateur invité choisit son mot de passe.
//
// ⚠️ NON TESTÉ — nécessite Identity activé. Suit le flux documenté par
// @netlify/identity (handleAuthCallback + acceptInvite/updateUser), jamais
// observé en conditions réelles sur ce site.

import { handleAuthCallback, acceptInvite, updateUser } from "@netlify/identity";

const formSection = document.getElementById("password-form-section");
const messageSection = document.getElementById("message-section");
const form = document.getElementById("password-form");
const passwordInput = document.getElementById("new-password");
const statusEl = document.getElementById("status");
const titleEl = document.getElementById("form-title");

function showMessage(text, isError) {
  messageSection.hidden = false;
  formSection.hidden = true;
  messageSection.textContent = text;
  messageSection.className = isError ? "error" : "";
}

async function run() {
  let result;
  try {
    result = await handleAuthCallback();
  } catch (err) {
    showMessage("Lien invalide ou expiré : " + (err && err.message ? err.message : "erreur inconnue"), true);
    return;
  }

  if (!result) {
    // Aucun paramètre d'authentification dans l'URL -- page ouverte
    // directement, pas via un lien email.
    window.location.href = "/admin/login.html";
    return;
  }

  if (result.type === "invite" && result.token) {
    titleEl.textContent = "Choisissez votre mot de passe";
    formSection.hidden = false;
    formSection.dataset.mode = "invite";
    formSection.dataset.token = result.token;
    return;
  }

  if (result.type === "recovery") {
    // Connecté via le jeton de récupération, mais doit encore choisir un
    // nouveau mot de passe avant de continuer.
    titleEl.textContent = "Choisissez un nouveau mot de passe";
    formSection.hidden = false;
    formSection.dataset.mode = "recovery";
    return;
  }

  // oauth / confirmation / email_change : déjà authentifié, rien de plus à faire.
  window.location.href = "/admin/dashboard.html";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = passwordInput.value;
  const mode = formSection.dataset.mode;
  statusEl.textContent = "";
  try {
    if (mode === "invite") {
      await acceptInvite(formSection.dataset.token, password);
    } else {
      await updateUser({ password });
    }
    window.location.href = "/admin/dashboard.html";
  } catch (err) {
    statusEl.textContent = err && err.message ? err.message : "Impossible de définir ce mot de passe.";
    statusEl.className = "error";
  }
});

run();
