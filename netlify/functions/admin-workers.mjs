// GET/POST /api/admin/workers -- gestion des agents locaux. administrateur :
// toutes agences. manager : sa propre agence uniquement. commercial : aucun
// accès.
//
// ⚠️ PARTIELLEMENT TESTÉ -- voir la même remarque que admin-users.mjs.

import { getDatabase } from "@netlify/database";
import { getAuthenticatedUser, unauthenticatedResponse, forbiddenResponse } from "./lib/user-auth.mjs";
import { canManageCollaborators, agencyScopeFor } from "./lib/access-control.mjs";
import { generateAgentToken, hashToken } from "./lib/worker-auth.mjs";

async function handleList(sql, user) {
  const scopeAgencyId = agencyScopeFor(user);
  const rows = scopeAgencyId
    ? await sql`SELECT id, name, agency_id, last_seen_at, version, active, created_at FROM workers WHERE agency_id = ${scopeAgencyId} ORDER BY created_at DESC`
    : await sql`SELECT id, name, agency_id, last_seen_at, version, active, created_at FROM workers ORDER BY created_at DESC`;
  // token_hash n'est jamais sélectionné ci-dessus -- rien à filtrer, il ne
  // peut donc jamais fuiter par erreur dans cette réponse.
  return new Response(JSON.stringify({ workers: rows }), { status: 200, headers: { "Content-Type": "application/json" } });
}

async function handleCreate(sql, user, req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Corps JSON invalide" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  const name = String(body.name || "").trim();
  const agencyId = body.agency_id;

  if (!name) return new Response(JSON.stringify({ error: "Nom requis" }), { status: 400, headers: { "Content-Type": "application/json" } });
  if (!agencyId) return new Response(JSON.stringify({ error: "agency_id requis" }), { status: 400, headers: { "Content-Type": "application/json" } });

  // Un manager ne peut créer un worker que pour sa propre agence -- même
  // règle que pour la création d'utilisateurs.
  if (user.role === "manager" && agencyId !== user.agencyId) {
    return forbiddenResponse("Vous ne pouvez créer un worker que pour votre propre agence");
  }

  const agencyRows = await sql`SELECT id FROM agencies WHERE id = ${agencyId} AND active = true`;
  if (!agencyRows[0]) {
    return new Response(JSON.stringify({ error: "Agence inconnue ou inactive" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // Token affiché UNE seule fois ici -- jamais stocké en clair, jamais
  // récupérable ensuite (voir worker-auth.mjs).
  const token = generateAgentToken();
  const created = await sql`
    INSERT INTO workers (name, agency_id, token_hash) VALUES (${name}, ${agencyId}, ${hashToken(token)})
    RETURNING id, name, agency_id, active, created_at
  `;
  return new Response(JSON.stringify({ worker: created[0], token }), { status: 201, headers: { "Content-Type": "application/json" } });
}

export default async (req) => {
  const { sql } = getDatabase();
  const user = await getAuthenticatedUser(sql);
  if (!user) return unauthenticatedResponse();
  if (!canManageCollaborators(user)) return forbiddenResponse();

  if (req.method === "GET") return handleList(sql, user);
  if (req.method === "POST") return handleCreate(sql, user, req);
  return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers: { "Content-Type": "application/json" } });
};

export const config = { path: "/api/admin/workers" };
