// POST /api/agent/jobs/:id/cancel -- l'agent (extension) signale lui-même
// qu'il arrête un traitement en cours (bouton "Annuler" local, ou détection
// d'une annulation demandée depuis le dashboard admin -- voir heartbeat).
// Scopé au worker authentifié uniquement, jamais un simple contrôle
// d'agence : deux PC de la même agence ne doivent jamais pouvoir agir sur
// le job de l'autre.

import { getDatabase } from "@netlify/database";
import { authenticateWorker, unauthorizedResponse } from "./lib/worker-auth.mjs";
import { canTransition, invalidTransitionResponse } from "./lib/job-transitions.mjs";

export default async (req, context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers: { "Content-Type": "application/json" } });
  }
  const { sql } = getDatabase();
  const worker = await authenticateWorker(sql, req.headers.get("authorization"));
  if (!worker) return unauthorizedResponse();

  const { id } = context.params;
  const rows = await sql`SELECT id, status FROM vehicle_jobs WHERE id = ${id} AND worker_id = ${worker.id}`;
  const job = rows[0];
  if (!job) return new Response(JSON.stringify({ error: "Job introuvable ou non détenu par ce worker" }), { status: 404, headers: { "Content-Type": "application/json" } });
  if (!canTransition(job.status, "cancelled")) return invalidTransitionResponse(job.status, "cancelled");

  const updated = await sql`
    UPDATE vehicle_jobs SET status = 'cancelled', completed_at = now()
    WHERE id = ${id} AND worker_id = ${worker.id} AND status = ${job.status}
    RETURNING id, status
  `;
  if (!updated[0]) return invalidTransitionResponse(job.status, "cancelled");

  await sql`INSERT INTO job_events (vehicle_job_id, level, step, message) VALUES (${id}, 'error', NULL, 'Annulé depuis le poste local')`;

  return new Response(JSON.stringify({ vehicle_job: updated[0] }), { status: 200, headers: { "Content-Type": "application/json" } });
};

export const config = { path: "/api/agent/jobs/:id/cancel" };
