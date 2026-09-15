// Source du bundle admin/dashboard.js -- session vérifiée via getUser()
// (cookie nf_jwt same-origin), plus rien envoyé manuellement en header.
//
// ⚠️ NON TESTÉ EN CONDITIONS RÉELLES -- voir la même remarque que login.js.

import { getUser, logout } from "@netlify/identity";

const statusEl = document.getElementById("status");
const badgeEl = document.getElementById("user-badge");
const logoutBtn = document.getElementById("btn-logout");

async function init() {
  let identityUser;
  try {
    identityUser = await getUser();
  } catch (e) {
    // getUser() est documenté "never throws" -- ce filet est une garantie
    // supplémentaire pour ne jamais laisser la page bloquée sur
    // "Chargement..." si ce n'était pas le cas en pratique.
    console.error("getUser() a levé une exception :", e);
    identityUser = null;
  }
  if (!identityUser) {
    // Redirection CÔTÉ CLIENT uniquement (confort/UX) -- si quelqu'un
    // contourne ce script, chaque appel /api/admin/* reste protégé
    // indépendamment côté serveur (voir lib/user-auth.mjs).
    window.location.href = "/admin/login.html";
    return;
  }
  await loadUserInfo();
}

async function loadUserInfo() {
  try {
    // Aucun header Authorization : le cookie nf_jwt part automatiquement
    // avec une requête same-origin, getUser() côté serveur le lit seul.
    // Le rôle affiché ici vient de la réponse serveur (source de vérité :
    // notre table `users`), jamais d'une donnée décidée par ce script.
    const res = await fetch("/api/admin/whoami");
    if (res.status === 401) {
      window.location.href = "/admin/login.html";
      return;
    }
    if (res.status === 403) {
      statusEl.className = "error";
      statusEl.textContent = "Compte non autorisé sur cet espace. Contactez un administrateur.";
      return;
    }
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    badgeEl.innerHTML = data.email + '<br><span class="role">' + data.role + "</span>";
  } catch (e) {
    statusEl.className = "error";
    statusEl.textContent = "Impossible de vérifier le compte : " + e.message;
  }
}

logoutBtn.addEventListener("click", async () => {
  await logout();
  window.location.href = "/admin/login.html";
});

init();
