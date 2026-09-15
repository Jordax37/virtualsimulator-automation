// Source du bundle admin/dashboard.js -- session vérifiée via getUser()
// (cookie nf_jwt same-origin), plus rien envoyé manuellement en header.
// Toute autorisation affichée ici (rôle, agence, ce qui est visible/caché)
// est un simple confort d'UX : chaque appel /api/admin/* reste vérifié
// indépendamment côté serveur (voir lib/user-auth.mjs et access-control.mjs),
// donc rien ici n'est une garantie de sécurité en soi.

import { getUser, logout } from "@netlify/identity";

const statusEl = document.getElementById("status");
const badgeEl = document.getElementById("user-badge");
const logoutBtn = document.getElementById("btn-logout");

let currentUser = null;
let agenciesCache = [];

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

async function apiFetch(path, options) {
  const res = await fetch(path, options);
  if (res.status === 401) {
    window.location.href = "/admin/login.html";
    throw new Error("Session expirée");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur HTTP ${res.status}`);
  return data;
}

// ---------- Initialisation ----------

async function init() {
  let identityUser;
  try {
    identityUser = await getUser();
  } catch (e) {
    console.error("getUser() a levé une exception :", e);
    identityUser = null;
  }
  if (!identityUser) {
    window.location.href = "/admin/login.html";
    return;
  }
  await loadUserInfo();
  if (!currentUser) return;

  setupTabs();
  setupForms();

  try {
    agenciesCache = (await apiFetch("/api/admin/agencies")).agencies;
  } catch (e) {
    agenciesCache = [];
  }
  applyRoleVisibility();
  populateAgencySelects();

  loadBatches();
  if (currentUser.role === "administrateur" || currentUser.role === "manager") {
    loadWorkers();
    loadUsers();
  }
  loadAnalytics();
}

async function loadUserInfo() {
  try {
    const data = await apiFetch("/api/admin/whoami");
    currentUser = { id: data.user_id, email: data.email, role: data.role, agencyId: data.agency_id };
    badgeEl.innerHTML = escapeHtml(data.email) + '<br><span class="role">' + escapeHtml(data.role) + "</span>";
  } catch (e) {
    statusEl.className = "error";
    statusEl.textContent = "Impossible de vérifier le compte : " + e.message;
  }
}

logoutBtn.addEventListener("click", async () => {
  await logout();
  window.location.href = "/admin/login.html";
});

function applyRoleVisibility() {
  const canManage = currentUser.role === "administrateur" || currentUser.role === "manager";
  document.getElementById("tab-btn-workers").hidden = !canManage;
  document.getElementById("tab-btn-users").hidden = !canManage;
  // Seul un administrateur choisit l'agence d'un batch -- manager/commercial
  // sont automatiquement rattachés à la leur côté serveur.
  document.getElementById("batch-agency-field").hidden = currentUser.role !== "administrateur";
  // Un manager crée toujours pour sa propre agence -- le champ reste visible
  // mais verrouillé, pour qu'il voie clairement laquelle sans pouvoir la changer.
  if (currentUser.role === "manager") {
    document.getElementById("worker-agency").disabled = true;
    document.getElementById("user-agency").disabled = true;
  }
}

function populateAgencySelects() {
  const options = agenciesCache.map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join("");
  for (const id of ["batch-agency", "worker-agency", "user-agency"]) {
    const el = document.getElementById(id);
    el.innerHTML = options || '<option value="">Aucune agence disponible</option>';
    if (currentUser.role !== "administrateur" && currentUser.agencyId) el.value = currentUser.agencyId;
  }
}

// ---------- Navigation ----------

function showPanel(name) {
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
  document.getElementById("panel-" + name).classList.add("active");
}

function setupTabs() {
  document.querySelectorAll("nav.tabs .tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("nav.tabs .tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      showPanel(btn.dataset.panel);
    });
  });
  document.getElementById("back-to-batches").addEventListener("click", () => {
    document.querySelectorAll("nav.tabs .tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.panel === "batches"));
    showPanel("batches");
  });
  document.getElementById("back-to-batch-detail").addEventListener("click", () => showPanel("batch-detail"));
}

// ---------- Batches ----------

async function loadBatches() {
  const el = document.getElementById("batches-list");
  el.innerHTML = '<div class="empty">Chargement...</div>';
  try {
    const { batches } = await apiFetch("/api/admin/batches");
    if (batches.length === 0) {
      el.innerHTML = '<div class="empty">Aucun batch pour le moment.</div>';
      return;
    }
    const agencyName = (id) => agenciesCache.find((a) => a.id === id)?.name || "—";
    el.innerHTML = `<table><thead><tr><th>Créé le</th><th>Agence</th><th>Marge</th><th>Véhicule US</th></tr></thead><tbody>
      ${batches
        .map(
          (b) => `<tr class="clickable" data-batch-id="${escapeHtml(b.id)}">
            <td>${fmtDate(b.created_at)}</td>
            <td>${escapeHtml(agencyName(b.agency_id))}</td>
            <td>${b.margin} €</td>
            <td>${b.vehicule_us ? "Oui" : "Non"}</td>
          </tr>`
        )
        .join("")}
    </tbody></table>`;
    el.querySelectorAll("tr.clickable").forEach((tr) => {
      tr.addEventListener("click", () => openBatchDetail(tr.dataset.batchId));
    });
  } catch (e) {
    el.innerHTML = `<div class="empty">Erreur : ${escapeHtml(e.message)}</div>`;
  }
}

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

async function cancelJob(jobId, onDone) {
  if (!confirm("Annuler ce véhicule ? Un traitement déjà en cours sur un poste ne sera pas interrompu physiquement, mais le serveur ne le considérera plus comme actif.")) return;
  try {
    await apiFetch(`/api/admin/jobs/${jobId}/cancel`, { method: "POST" });
    onDone();
  } catch (e) {
    alert("Erreur : " + e.message);
  }
}

async function openBatchDetail(batchId) {
  showPanel("batch-detail");
  const el = document.getElementById("batch-detail-jobs");
  el.innerHTML = '<div class="empty">Chargement...</div>';
  try {
    const { vehicle_jobs } = await apiFetch(`/api/admin/batches/${batchId}`);
    if (vehicle_jobs.length === 0) {
      el.innerHTML = '<div class="empty">Aucun véhicule dans ce batch.</div>';
      return;
    }
    el.innerHTML = `<table><thead><tr><th>Statut</th><th>Étape</th><th>URL source</th><th>Tentatives</th><th>Créé le</th><th></th></tr></thead><tbody>
      ${vehicle_jobs
        .map(
          (j) => `<tr class="clickable" data-job-id="${escapeHtml(j.id)}">
            <td><span class="badge ${escapeHtml(j.status)}">${escapeHtml(j.status)}</span></td>
            <td>${escapeHtml(j.current_step || "—")}</td>
            <td style="max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(j.source_url)}</td>
            <td>${j.retry_count}</td>
            <td>${fmtDate(j.created_at)}</td>
            <td>${TERMINAL_STATUSES.has(j.status) ? "" : `<button class="danger" data-cancel-job="${escapeHtml(j.id)}">Annuler</button>`}</td>
          </tr>`
        )
        .join("")}
    </tbody></table>`;
    el.querySelectorAll("tr.clickable").forEach((tr) => {
      tr.addEventListener("click", () => openJobDetail(tr.dataset.jobId));
    });
    el.querySelectorAll("[data-cancel-job]").forEach((btn) => {
      btn.addEventListener("click", (evt) => {
        evt.stopPropagation();
        cancelJob(btn.dataset.cancelJob, () => openBatchDetail(batchId));
      });
    });
  } catch (e) {
    el.innerHTML = `<div class="empty">Erreur : ${escapeHtml(e.message)}</div>`;
  }
}

async function openJobDetail(jobId) {
  showPanel("job-detail");
  const listEl = document.getElementById("job-events-list");
  const statusEl2 = document.getElementById("job-detail-status");
  const urlEl = document.getElementById("job-detail-url");
  listEl.innerHTML = '<div class="empty">Chargement...</div>';
  statusEl2.innerHTML = "";
  urlEl.textContent = "";
  try {
    const [{ vehicle_job }, { events }] = await Promise.all([
      apiFetch(`/api/admin/jobs/${jobId}`),
      apiFetch(`/api/admin/jobs/${jobId}/events`),
    ]);
    statusEl2.innerHTML = `<span class="badge ${escapeHtml(vehicle_job.status)}">${escapeHtml(vehicle_job.status)}</span>`;
    if (!TERMINAL_STATUSES.has(vehicle_job.status)) {
      statusEl2.innerHTML += ` <button class="danger" id="btn-cancel-job-detail" style="margin-left:8px;">Annuler</button>`;
      document.getElementById("btn-cancel-job-detail").addEventListener("click", () => cancelJob(jobId, () => openJobDetail(jobId)));
    }
    urlEl.textContent = vehicle_job.source_url;
    if (events.length === 0) {
      listEl.innerHTML = '<div class="empty">Aucun événement pour le moment.</div>';
      return;
    }
    listEl.innerHTML = `<table><thead><tr><th>Heure</th><th>Niveau</th><th>Étape</th><th>Message</th></tr></thead><tbody>
      ${events
        .map(
          (e) => `<tr>
            <td>${fmtDate(e.timestamp)}</td>
            <td>${escapeHtml(e.level)}</td>
            <td>${escapeHtml(e.step || "—")}</td>
            <td>${escapeHtml(e.message)}${e.progress_total ? ` (${e.progress_current}/${e.progress_total})` : ""}</td>
          </tr>`
        )
        .join("")}
    </tbody></table>`;
  } catch (e) {
    listEl.innerHTML = `<div class="empty">Erreur : ${escapeHtml(e.message)}</div>`;
  }
}

// ---------- Formulaires ----------

function setupForms() {
  document.getElementById("btn-create-batch").addEventListener("click", async () => {
    const errEl = document.getElementById("batch-form-error");
    errEl.textContent = "";
    const urls = document
      .getElementById("batch-urls")
      .value.split("\n")
      .map((u) => u.trim())
      .filter(Boolean);
    if (urls.length === 0) {
      errEl.textContent = "Au moins une URL est requise.";
      return;
    }
    const body = {
      urls,
      margin: document.getElementById("batch-margin").value,
      vehicule_us: document.getElementById("batch-vehicule-us").checked,
    };
    if (currentUser.role === "administrateur") body.agency_id = document.getElementById("batch-agency").value;
    try {
      await apiFetch("/api/admin/batches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      document.getElementById("batch-urls").value = "";
      loadBatches();
    } catch (e) {
      errEl.textContent = e.message;
    }
  });

  document.getElementById("btn-create-worker").addEventListener("click", async () => {
    const errEl = document.getElementById("worker-form-error");
    errEl.textContent = "";
    const name = document.getElementById("worker-name").value.trim();
    const agency_id = document.getElementById("worker-agency").value;
    if (!name) {
      errEl.textContent = "Le nom du PC est requis.";
      return;
    }
    try {
      const { worker, token } = await apiFetch("/api/admin/workers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, agency_id }),
      });
      document.getElementById("worker-name").value = "";
      document.getElementById("worker-token-reveal").innerHTML = `<div class="token-reveal">
        ⚠️ Token pour <strong>${escapeHtml(worker.name)}</strong> — copiez-le maintenant, il ne sera plus jamais affiché :
        <code>${escapeHtml(token)}</code>
      </div>`;
      loadWorkers();
    } catch (e) {
      errEl.textContent = e.message;
    }
  });

  document.getElementById("btn-create-user").addEventListener("click", async () => {
    const errEl = document.getElementById("user-form-error");
    errEl.textContent = "";
    const email = document.getElementById("user-email").value.trim();
    const role = document.getElementById("user-role").value;
    const body = { email, role };
    if (role !== "administrateur") body.agency_id = document.getElementById("user-agency").value;
    if (!email) {
      errEl.textContent = "L'email est requis.";
      return;
    }
    try {
      await apiFetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      document.getElementById("user-email").value = "";
      loadUsers();
    } catch (e) {
      errEl.textContent = e.message;
    }
  });
}

// ---------- Workers ----------

async function loadWorkers() {
  const el = document.getElementById("workers-list");
  el.innerHTML = '<div class="empty">Chargement...</div>';
  try {
    const { workers } = await apiFetch("/api/admin/workers");
    if (workers.length === 0) {
      el.innerHTML = '<div class="empty">Aucun worker pour le moment.</div>';
      return;
    }
    const agencyName = (id) => agenciesCache.find((a) => a.id === id)?.name || "—";
    el.innerHTML = `<table><thead><tr><th>Nom</th><th>Agence</th><th>Actif</th><th>Vu la dernière fois</th><th></th></tr></thead><tbody>
      ${workers
        .map(
          (w) => `<tr data-worker-id="${escapeHtml(w.id)}">
            <td>${escapeHtml(w.name)}</td>
            <td>${escapeHtml(agencyName(w.agency_id))}</td>
            <td>${w.active ? "Oui" : "Révoqué"}</td>
            <td>${fmtDate(w.last_seen_at)}</td>
            <td>${w.active ? `<button class="danger" data-revoke="${escapeHtml(w.id)}">Révoquer</button>` : ""}</td>
          </tr>`
        )
        .join("")}
    </tbody></table>`;
    el.querySelectorAll("[data-revoke]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Révoquer ce worker ? Il ne pourra plus s'authentifier.")) return;
        try {
          await apiFetch(`/api/admin/workers/${btn.dataset.revoke}/revoke`, { method: "POST" });
          loadWorkers();
        } catch (e) {
          alert("Erreur : " + e.message);
        }
      });
    });
  } catch (e) {
    el.innerHTML = `<div class="empty">Erreur : ${escapeHtml(e.message)}</div>`;
  }
}

// ---------- Utilisateurs ----------

async function loadUsers() {
  const el = document.getElementById("users-list");
  el.innerHTML = '<div class="empty">Chargement...</div>';
  try {
    const { users } = await apiFetch("/api/admin/users");
    if (users.length === 0) {
      el.innerHTML = '<div class="empty">Aucun collaborateur pour le moment.</div>';
      return;
    }
    const agencyName = (id) => (id ? agenciesCache.find((a) => a.id === id)?.name || "—" : "Toutes");
    el.innerHTML = `<table><thead><tr><th>Email</th><th>Rôle</th><th>Agence</th><th>Compte activé</th><th>Créé le</th></tr></thead><tbody>
      ${users
        .map(
          (u) => `<tr>
            <td>${escapeHtml(u.email)}</td>
            <td>${escapeHtml(u.role)}</td>
            <td>${escapeHtml(agencyName(u.agency_id))}</td>
            <td>${u.linked ? "Oui" : "En attente"}</td>
            <td>${fmtDate(u.created_at)}</td>
          </tr>`
        )
        .join("")}
    </tbody></table>`;
  } catch (e) {
    el.innerHTML = `<div class="empty">Erreur : ${escapeHtml(e.message)}</div>`;
  }
}

// ---------- Analytique ----------

const STATUS_ORDER = ["queued", "claimed", "running", "action_required", "retrying", "completed", "failed", "cancelled"];
const STATUS_LABELS = {
  queued: "En attente",
  claimed: "Réclamé",
  running: "En cours",
  action_required: "Action requise",
  retrying: "Nouvelle tentative",
  completed: "Terminé",
  failed: "Échoué",
  cancelled: "Annulé",
};
const STATUS_COLORS = {
  queued: "#8fabff",
  claimed: "#8fabff",
  running: "#fbbf24",
  action_required: "#fb923c",
  retrying: "#f87171",
  completed: "#34d399",
  failed: "#f87171",
  cancelled: "#726d8f",
};

async function loadAnalytics() {
  const summaryEl = document.getElementById("analytics-summary");
  const barsEl = document.getElementById("analytics-status-bars");
  const agenciesCard = document.getElementById("analytics-agencies-card");
  const workersCard = document.getElementById("analytics-workers-card");
  try {
    const data = await apiFetch("/api/admin/analytics");
    const completed = data.by_status.completed || 0;
    const failed = data.by_status.failed || 0;
    const cancelled = data.by_status.cancelled || 0;
    const terminal = completed + failed + cancelled;
    const successRate = terminal > 0 ? Math.round((completed / terminal) * 100) : null;

    summaryEl.innerHTML = `
      <div class="stat-card"><div class="stat-label">Batches</div><div class="stat-value">${data.totals.batches}</div></div>
      <div class="stat-card"><div class="stat-label">Véhicules</div><div class="stat-value accent">${data.totals.vehicle_jobs}</div></div>
      <div class="stat-card"><div class="stat-label">Terminés</div><div class="stat-value ok">${completed}</div></div>
      <div class="stat-card"><div class="stat-label">Échoués</div><div class="stat-value danger">${failed}</div></div>
      <div class="stat-card"><div class="stat-label">Taux de réussite</div><div class="stat-value">${successRate === null ? "—" : successRate + "%"}</div></div>
    `;

    if (data.totals.vehicle_jobs === 0) {
      barsEl.innerHTML = '<div class="empty">Aucun véhicule pour le moment.</div>';
    } else {
      const maxCount = Math.max(1, ...STATUS_ORDER.map((s) => data.by_status[s] || 0));
      barsEl.innerHTML = STATUS_ORDER.map((s) => {
        const count = data.by_status[s] || 0;
        const pct = Math.round((count / maxCount) * 100);
        return `<div class="status-bar-row">
          <div class="sb-label">${STATUS_LABELS[s]}</div>
          <div class="sb-track"><div class="sb-fill" style="width:${pct}%;background:${STATUS_COLORS[s]};"></div></div>
          <div class="sb-count">${count}</div>
        </div>`;
      }).join("");
    }

    if (data.agencies.length > 0) {
      agenciesCard.hidden = false;
      document.getElementById("analytics-agencies").innerHTML = `<table><thead><tr><th>Agence</th><th>Batches</th><th>Véhicules</th><th>Terminés</th><th>Taux</th></tr></thead><tbody>
        ${data.agencies
          .map((a) => {
            const rate = a.jobs > 0 ? Math.round((a.completed / a.jobs) * 100) : null;
            return `<tr><td>${escapeHtml(a.name)}</td><td>${a.batches}</td><td>${a.jobs}</td><td>${a.completed}</td><td>${rate === null ? "—" : rate + "%"}</td></tr>`;
          })
          .join("")}
      </tbody></table>`;
    } else {
      agenciesCard.hidden = true;
    }

    if (data.workers.length > 0) {
      workersCard.hidden = false;
      const agencyName = (id) => agenciesCache.find((a) => a.id === id)?.name || "—";
      document.getElementById("analytics-workers").innerHTML = `<table><thead><tr><th>Worker</th><th>Agence</th><th>Terminés</th><th>Actif</th><th>Vu la dernière fois</th></tr></thead><tbody>
        ${data.workers
          .map(
            (w) =>
              `<tr><td>${escapeHtml(w.name)}</td><td>${escapeHtml(agencyName(w.agency_id))}</td><td>${w.completed_count}</td><td>${w.active ? "Oui" : "Révoqué"}</td><td>${fmtDate(w.last_seen_at)}</td></tr>`
          )
          .join("")}
      </tbody></table>`;
    } else {
      workersCard.hidden = true;
    }
  } catch (e) {
    summaryEl.innerHTML = `<div class="empty">Erreur : ${escapeHtml(e.message)}</div>`;
    barsEl.innerHTML = "";
  }
}

init();
