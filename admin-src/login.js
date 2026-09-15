// Source du bundle admin/login.js (voir esbuild.admin.mjs) -- page de
// connexion personnalisée Virtual, sans widget/modale Identity.
//
// ⚠️ NON TESTÉ EN CONDITIONS RÉELLES -- login() nécessite Netlify Identity
// activé en production. Le chargement du bundle et la structure du
// formulaire sont vérifiables localement, pas l'appel réseau réel à
// l'API Identity.

import { login, getUser } from "@netlify/identity";

const form = document.getElementById("login-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const submitBtn = document.getElementById("btn-login");
const statusEl = document.getElementById("status");

function showError(message) {
  statusEl.textContent = message;
  statusEl.className = "error";
}

// Déjà connecté -> inutile de repasser par cette page. Redirection CÔTÉ
// CLIENT uniquement (confort) -- la vraie protection est le contrôle de
// rôle côté serveur sur chaque appel /api/admin/*.
getUser()
  .then((user) => {
    if (user) window.location.href = "/admin/dashboard.html";
  })
  .catch(() => {
    // getUser() ne devrait jamais rejeter (documenté "never throws"), mais
    // on ne bloque jamais l'affichage du formulaire sur cette vérification.
  });

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  statusEl.textContent = "";
  statusEl.className = "";
  submitBtn.disabled = true;
  submitBtn.textContent = "Connexion...";

  try {
    // login() pose les cookies nf_jwt/nf_refresh (same-origin) -- c'est ce
    // cookie, pas un token manuel, que les fonctions /api/admin/* liront
    // ensuite via getUser() côté serveur.
    await login(emailInput.value.trim(), passwordInput.value);
    window.location.href = "/admin/dashboard.html";
  } catch (err) {
    showError(err && err.message ? err.message : "Connexion impossible. Vérifiez vos identifiants.");
    submitBtn.disabled = false;
    submitBtn.textContent = "Se connecter";
  }
});
