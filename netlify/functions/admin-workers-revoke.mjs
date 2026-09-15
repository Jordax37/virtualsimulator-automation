// POST /api/admin/workers/:id/revoke -- révoque un token worker (active =
// false). Jamais de suppression physique (voir la règle explicite sur la
// conservation de l'historique métier).
//
// ⚠️ PARTIELLEMENT TESTÉ -- voir la même remarque que admin-users.mjs.

import { getDatabase } from "@netlify/database";
import { getAuthenticatedUser, unauthenticatedResponse, forbiddenResponse } from "./lib/user-auth.mjs";
import { canManageCollaborators } from "./lib/access-control.mjs";

export default async (req, context) => {
  const { sql } = getDatabase();
  const user = await getAuthenticatedUser(sql);
  if (!user) return unauthenticatedResponse();
  if (!canManageCollaborators(user)) return forbiddenResponse();
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers: { "Content-Type": "application/json" } });
  }

  const { id } = context.params;
  const rows = await sql`SELECT id, agency_id FROM workers WHERE id = ${id}`;
  const worker = rows[0];
  if (!worker) return new Response(JSON.stringify({ error: "Worker introuvable" }), { status: 404, headers: { "Content-Type": "application/json" } });

  if (user.role === "manager" && worker.agency_id !== user.agencyId) {
    return forbiddenResponse("Ce worker n'appartient pas à votre agence");
  }

  const updated = await sql`
    UPDATE workers SET active = false WHERE id = ${id}
    RETURNING id, name, active
  `;
  return new Response(JSON.stringify({ worker: updated[0] }), { status: 200, headers: { "Content-Type": "application/json" } });
};

export const config = { path: "/api/admin/workers/:id/revoke" };
