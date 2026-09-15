// GET/POST /api/admin/users -- gestion des comptes humains (pré-provisionnement).
// administrateur : toutes agences, tous rôles. manager : sa propre agence
// uniquement, ne peut jamais créer un administrateur. commercial : aucun accès.
//
// ⚠️ PARTIELLEMENT TESTÉ : logique SQL/permissions testée directement contre
// la base locale, getAuthenticatedUser()/getUser() eux-mêmes NON TESTÉS
// (nécessitent Identity activé).

import { getDatabase } from "@netlify/database";
import { getAuthenticatedUser, unauthenticatedResponse, forbiddenResponse } from "./lib/user-auth.mjs";
import { canManageCollaborators, canAssignRoleAndAgency, agencyScopeFor } from "./lib/access-control.mjs";

const VALID_ROLES = ["administrateur", "manager", "commercial"];

async function handleList(sql, user) {
  const scopeAgencyId = agencyScopeFor(user);
  const rows = scopeAgencyId
    ? await sql`SELECT id, email, role, agency_id, identity_id, created_at FROM users WHERE agency_id = ${scopeAgencyId} ORDER BY created_at DESC`
    : await sql`SELECT id, email, role, agency_id, identity_id, created_at FROM users ORDER BY created_at DESC`;
  // identity_id n'est renvoyé que sous forme de booléen "lié ou pas" -- pas
  // d'utilité pour l'admin de voir l'id brut, seulement si le compte a déjà
  // été activé par la personne.
  const users = rows.map(({ identity_id, ...rest }) => ({ ...rest, linked: identity_id !== null }));
  return new Response(JSON.stringify({ users }), { status: 200, headers: { "Content-Type": "application/json" } });
}

async function handleCreate(sql, user, req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Corps JSON invalide" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  const email = String(body.email || "").trim().toLowerCase();
  const role = body.role;
  const agencyId = body.agency_id || null;

  if (!email || !email.includes("@")) {
    return new Response(JSON.stringify({ error: "Email invalide" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  if (!VALID_ROLES.includes(role)) {
    return new Response(JSON.stringify({ error: "Rôle invalide" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  // Un administrateur n'est rattaché à aucune agence en particulier (voir
  // agencyScopeFor) -- agency_id n'est donc obligatoire que pour
  // manager/commercial, jamais pour créer un compte administrateur.
  if (!agencyId && role !== "administrateur") {
    return new Response(JSON.stringify({ error: "agency_id requis" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  if (!canAssignRoleAndAgency(user, role, agencyId)) {
    return forbiddenResponse("Vous ne pouvez pas attribuer ce rôle ou cette agence");
  }

  if (agencyId) {
    const agencyRows = await sql`SELECT id FROM agencies WHERE id = ${agencyId} AND active = true`;
    if (!agencyRows[0]) {
      return new Response(JSON.stringify({ error: "Agence inconnue ou inactive" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
  }

  try {
    // identity_id volontairement NULL : la liaison ne se fait qu'à la
    // première connexion réelle (voir user-auth.mjs), jamais ici.
    const created = await sql`
      INSERT INTO users (email, role, agency_id) VALUES (${email}, ${role}, ${agencyId})
      RETURNING id, email, role, agency_id, created_at
    `;
    return new Response(JSON.stringify({ user: created[0] }), { status: 201, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    if (String(e.message || "").includes("users_email_key")) {
      return new Response(JSON.stringify({ error: "Un compte existe déjà pour cet email" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw e;
  }
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

export const config = { path: "/api/admin/users" };
