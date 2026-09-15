// POST /api/admin/jobs/:id/cancel -- annule un vehicle_job. Autorisé depuis
// queued/claimed/running/action_required/retrying (voir job-transitions.mjs),
// jamais depuis un état déjà terminal. Même contrôle d'accès par objet que
// admin-jobs-get.mjs : administrateur (tout), manager (son agence),
// commercial (son agence ET uniquement ses propres batches).
//
// Annuler un job 'claimed'/'running' est du meilleur effort côté agent local
// : rien ici n'interrompt physiquement un traitement déjà en cours sur le
// poste qui l'a réclamé (pas de canal serveur -> extension pour ça). Le
// serveur cesse simplement de considérer le job comme actif ; un éventuel
// /complete ou /fail envoyé ensuite par ce poste sera rejeté (transition
// invalide depuis un état terminal), sans corrompre l'état.

import { getDatabase } from "@netlify/database";
import { getAuthenticatedUser, unauthenticatedResponse, forbiddenResponse } from "./lib/user-auth.mjs";
import { mustRestrictToOwnBatches } from "./lib/access-control.mjs";
import { canTransition, invalidTransitionResponse } from "./lib/job-transitions.mjs";

export default async (req, context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers: { "Content-Type": "application/json" } });
  }
  const { sql } = getDatabase();
  const user = await getAuthenticatedUser(sql);
  if (!user) return unauthenticatedResponse();

  const { id } = context.params;
  const rows = await sql`
    SELECT vj.id, vj.status, b.agency_id AS batch_agency_id, b.created_by AS batch_created_by
    FROM vehicle_jobs vj JOIN batches b ON b.id = vj.batch_id
    WHERE vj.id = ${id}
  `;
  const job = rows[0];
  if (!job) return new Response(JSON.stringify({ error: "Job introuvable" }), { status: 404, headers: { "Content-Type": "application/json" } });

  if (user.role !== "administrateur" && job.batch_agency_id !== user.agencyId) {
    return forbiddenResponse("Ce job n'appartient pas à votre agence");
  }
  if (mustRestrictToOwnBatches(user) && job.batch_created_by !== user.id) {
    return forbiddenResponse("Ce job ne provient pas d'un de vos batches");
  }
  if (!canTransition(job.status, "cancelled")) return invalidTransitionResponse(job.status, "cancelled");

  const updated = await sql`
    UPDATE vehicle_jobs SET status = 'cancelled', completed_at = now()
    WHERE id = ${id} AND status = ${job.status}
    RETURNING id, status
  `;
  if (!updated[0]) return invalidTransitionResponse(job.status, "cancelled");

  await sql`INSERT INTO job_events (vehicle_job_id, level, step, message) VALUES (${id}, 'error', NULL, 'Annulé depuis le dashboard')`;

  return new Response(JSON.stringify({ vehicle_job: updated[0] }), { status: 200, headers: { "Content-Type": "application/json" } });
};

export const config = { path: "/api/admin/jobs/:id/cancel" };
