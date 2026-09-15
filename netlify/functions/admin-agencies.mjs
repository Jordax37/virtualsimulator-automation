// GET /api/admin/agencies -- liste des agences actives. Lecture seule,
// aucune création/modification exposée ici (les agences sont seedées par
// migration, voir 0003_seed-orleans-worker) -- sert uniquement à peupler les
// menus déroulants du dashboard (choix d'agence lors de la création d'un
// batch/utilisateur/worker). Aucune donnée sensible (nom/code), accessible à
// tout utilisateur authentifié quel que soit son rôle.

import { getDatabase } from "@netlify/database";
import { getAuthenticatedUser, unauthenticatedResponse } from "./lib/user-auth.mjs";

export default async (req) => {
  const { sql } = getDatabase();
  const user = await getAuthenticatedUser(sql);
  if (!user) return unauthenticatedResponse();
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers: { "Content-Type": "application/json" } });
  }

  const agencies = await sql`SELECT id, name, code FROM agencies WHERE active = true ORDER BY name`;
  return new Response(JSON.stringify({ agencies }), { status: 200, headers: { "Content-Type": "application/json" } });
};

export const config = { path: "/api/admin/agencies" };
