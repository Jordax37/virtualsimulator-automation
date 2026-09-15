// GET/POST /api/admin/batches -- création et liste des batches. Tous les
// rôles peuvent créer (administrateur/manager/commercial). La lecture est
// filtrée par portée : administrateur voit tout, manager voit son agence,
// commercial ne voit que ses propres batches.
//
// La création est TRANSACTIONNELLE (1 batch + N vehicle_jobs, tout ou rien)
// -- utilise directement `pool` (vraie transaction SQL BEGIN/COMMIT/ROLLBACK)
// plutôt que le client `sql` (simple wrapper par templates, sans notion de
// transaction multi-requêtes).
//
// ⚠️ PARTIELLEMENT TESTÉ -- la transaction et le filtrage par rôle sont
// testés directement contre la base locale ; getAuthenticatedUser()/getUser()
// eux-mêmes NON TESTÉS (nécessitent Identity activé).

import { getDatabase } from "@netlify/database";
import { getAuthenticatedUser, unauthenticatedResponse, forbiddenResponse } from "./lib/user-auth.mjs";
import { agencyScopeFor, mustRestrictToOwnBatches } from "./lib/access-control.mjs";
import { validateSourceUrl } from "./lib/source-validation.mjs";

async function handleList(sql, user) {
  const scopeAgencyId = agencyScopeFor(user);
  const restrictOwn = mustRestrictToOwnBatches(user);

  let rows;
  if (restrictOwn) {
    rows = await sql`SELECT id, created_by, agency_id, margin, vehicule_us, created_at FROM batches WHERE created_by = ${user.id} ORDER BY created_at DESC`;
  } else if (scopeAgencyId) {
    rows = await sql`SELECT id, created_by, agency_id, margin, vehicule_us, created_at FROM batches WHERE agency_id = ${scopeAgencyId} ORDER BY created_at DESC`;
  } else {
    rows = await sql`SELECT id, created_by, agency_id, margin, vehicule_us, created_at FROM batches ORDER BY created_at DESC`;
  }
  return new Response(JSON.stringify({ batches: rows }), { status: 200, headers: { "Content-Type": "application/json" } });
}

async function handleCreate(pool, user, req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Corps JSON invalide" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const urls = Array.isArray(body.urls) ? body.urls : [];
  if (urls.length === 0) {
    return new Response(JSON.stringify({ error: "Au moins une URL est requise" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // Validation ET calcul de source_domain CÔTÉ SERVEUR uniquement -- jamais
  // une valeur envoyée par le navigateur.
  const validated = [];
  const rejected = [];
  for (const rawUrl of urls) {
    const domain = validateSourceUrl(rawUrl);
    if (domain) validated.push({ url: rawUrl, domain });
    else rejected.push(rawUrl);
  }
  if (rejected.length > 0) {
    return new Response(
      JSON.stringify({ error: "URL(s) refusée(s) : domaine non autorisé ou URL invalide", rejected }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const marginRaw = body.margin;
  const margin = marginRaw === "" || marginRaw === null || marginRaw === undefined ? NaN : Number(marginRaw);
  if (!Number.isFinite(margin) || margin < 0) {
    return new Response(JSON.stringify({ error: "margin invalide" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  const vehiculeUs = !!body.vehicule_us;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const batchResult = await client.query(
      "INSERT INTO batches (created_by, agency_id, margin, vehicule_us) VALUES ($1, $2, $3, $4) RETURNING id, created_by, agency_id, margin, vehicule_us, created_at",
      [user.id, user.agencyId, margin, vehiculeUs]
    );
    const batch = batchResult.rows[0];

    const jobs = [];
    for (const { url, domain } of validated) {
      const jobResult = await client.query(
        "INSERT INTO vehicle_jobs (batch_id, source_url, source_domain) VALUES ($1, $2, $3) RETURNING id, source_url, source_domain, status",
        [batch.id, url, domain]
      );
      jobs.push(jobResult.rows[0]);
    }

    await client.query("COMMIT");
    return new Response(JSON.stringify({ batch, vehicle_jobs: jobs }), { status: 201, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export default async (req) => {
  const { sql, pool } = getDatabase();
  const user = await getAuthenticatedUser(sql);
  if (!user) return unauthenticatedResponse();

  if (req.method === "GET") return handleList(sql, user);
  if (req.method === "POST") return handleCreate(pool, user, req);
  return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers: { "Content-Type": "application/json" } });
};

export const config = { path: "/api/admin/batches" };
