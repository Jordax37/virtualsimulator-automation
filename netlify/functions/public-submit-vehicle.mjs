// POST /api/public/submissions -- soumission publique d'un véhicule à
// traiter, SANS authentification : accessible depuis l'onglet "Ajouter un
// véhicule" du simulateur (public, pas de connexion), pour que les
// commerciaux puissent mettre un véhicule en file d'attente sans passer par
// le dashboard admin. Décision produit explicite : le simulateur étant déjà
// entièrement public, ce formulaire l'est aussi (pas de compte à créer par
// commercial) -- accepté comme compromis, jamais de donnée sensible exposée.
//
// Crée UN batch (rattaché à l'utilisateur système "soumissions-publiques",
// voir migration 0004) contenant UN SEUL vehicle_job. Toujours margin=1990
// (valeur par défaut standard, voir DEFAULT_CONFIG côté extension) -- un
// commercial ne choisit pas la marge de courtage, décision admin.

import { getDatabase } from "@netlify/database";
import { validateSourceUrl } from "./lib/source-validation.mjs";

const PUBLIC_SUBMITTER_EMAIL = "soumissions-publiques@virtual.internal";
const DEFAULT_MARGIN = 1990;
const MAX_NAME_LENGTH = 80;

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers: { "Content-Type": "application/json" } });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Corps JSON invalide" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const submitterName = String(body.submitter_name || "").trim().slice(0, MAX_NAME_LENGTH);
  if (!submitterName) {
    return new Response(JSON.stringify({ error: "Votre nom est requis" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const domain = validateSourceUrl(body.vehicle_url);
  if (!domain) {
    return new Response(
      JSON.stringify({ error: "URL refusée : lien invalide ou site non pris en charge" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { sql, pool } = getDatabase();

  const agencyRows = await sql`SELECT id FROM agencies WHERE id = ${body.agency_id} AND active = true`;
  if (!agencyRows[0]) {
    return new Response(JSON.stringify({ error: "Agence inconnue ou inactive" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const systemUserRows = await sql`SELECT id FROM users WHERE email = ${PUBLIC_SUBMITTER_EMAIL}`;
  const systemUser = systemUserRows[0];
  if (!systemUser) {
    // Ne devrait jamais arriver (créé par la migration 0004) -- message
    // explicite plutôt qu'une erreur de contrainte FK obscure si jamais.
    return new Response(
      JSON.stringify({ error: "Configuration serveur incomplète (utilisateur système des soumissions publiques manquant)" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const batchResult = await client.query(
      "INSERT INTO batches (created_by, agency_id, margin, vehicule_us, submitted_by_name) VALUES ($1, $2, $3, false, $4) RETURNING id",
      [systemUser.id, body.agency_id, DEFAULT_MARGIN, submitterName]
    );
    const batchId = batchResult.rows[0].id;

    const jobResult = await client.query(
      "INSERT INTO vehicle_jobs (batch_id, source_url, source_domain) VALUES ($1, $2, $3) RETURNING id, source_url, status, created_at",
      [batchId, body.vehicle_url, domain]
    );

    await client.query("COMMIT");
    return new Response(
      JSON.stringify({ vehicle_job: jobResult.rows[0] }),
      { status: 201, headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};

export const config = { path: "/api/public/submissions" };
