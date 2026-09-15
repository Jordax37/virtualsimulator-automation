// POST /api/agent/jobs/:id/start -- claimed -> running. Uniquement si le job
// appartient au worker authentifié (WHERE id = $id AND worker_id = $worker,
// jamais juste une vérification d'agence -- deux PC de la même agence ne
// doivent jamais pouvoir agir sur le job de l'autre). Idempotent : rappelé
// alors que le job est déjà 'running' pour ce même worker (retry réseau de
// l'extension), renvoie le même succès sans rien recommencer.
//
// ⚠️ PARTIELLEMENT TESTÉ -- authenticateWorker() + logique SQL testables
// sans Identity ; voir le script de test pour la couverture réelle.

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
  const rows = await sql`SELECT id, status, worker_id, started_at FROM vehicle_jobs WHERE id = ${id}`;
  const job = rows[0];
  if (!job) return new Response(JSON.stringify({ error: "Job introuvable" }), { status: 404, headers: { "Content-Type": "application/json" } });
  if (job.worker_id !== worker.id) {
    return new Response(JSON.stringify({ error: "Ce job n'est pas réservé par ce worker" }), { status: 403, headers: { "Content-Type": "application/json" } });
  }
  // Idempotence : un /start déjà appliqué par CE worker (ex: retry réseau de
  // l'extension) renvoie le même succès plutôt qu'une erreur de transition.
  if (job.status === "running") {
    return new Response(JSON.stringify({ vehicle_job: { id: job.id, status: job.status, started_at: job.started_at } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!canTransition(job.status, "running")) return invalidTransitionResponse(job.status, "running");

  const updated = await sql`
    UPDATE vehicle_jobs SET status = 'running', started_at = now()
    WHERE id = ${id} AND worker_id = ${worker.id} AND status = ${job.status}
    RETURNING id, status, started_at
  `;
  if (!updated[0]) return invalidTransitionResponse(job.status, "running"); // concurrence : déjà changé entre-temps
  return new Response(JSON.stringify({ vehicle_job: updated[0] }), { status: 200, headers: { "Content-Type": "application/json" } });
};

export const config = { path: "/api/agent/jobs/:id/start" };
