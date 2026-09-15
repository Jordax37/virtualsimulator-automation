// POST /api/agent/jobs/:id/fail -- running -> retrying -> queued (si
// retryable et sous le seuil de tentatives) OU running -> failed (sinon).
// Le SERVEUR décide seul, jamais l'extension : retryable=true dans le corps
// n'est qu'une indication, pas une garantie de nouvelle tentative.

import { getDatabase } from "@netlify/database";
import { authenticateWorker, unauthorizedResponse } from "./lib/worker-auth.mjs";
import { canTransition, invalidTransitionResponse } from "./lib/job-transitions.mjs";

// Nombre maximum de tentatives avant échec définitif -- ajustable selon
// l'expérience réelle, pas de valeur imposée par la spec initiale.
const MAX_RETRIES = 3;

export default async (req, context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers: { "Content-Type": "application/json" } });
  }
  const { sql } = getDatabase();
  const worker = await authenticateWorker(sql, req.headers.get("authorization"));
  if (!worker) return unauthorizedResponse();

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Corps JSON invalide" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  const { step, message } = body;
  const clientRetryable = !!body.retryable;
  if (!message) return new Response(JSON.stringify({ error: "message requis" }), { status: 400, headers: { "Content-Type": "application/json" } });

  const { id } = context.params;
  const rows = await sql`SELECT id, status, retry_count FROM vehicle_jobs WHERE id = ${id} AND worker_id = ${worker.id}`;
  const job = rows[0];
  if (!job) return new Response(JSON.stringify({ error: "Job introuvable ou non détenu par ce worker" }), { status: 404, headers: { "Content-Type": "application/json" } });

  // Décision serveur : retryable côté client n'est qu'une indication, le
  // nombre de tentatives déjà effectuées (retry_count, jamais modifiable par
  // l'extension) tranche en dernier ressort.
  const willRetry = clientRetryable && job.retry_count < MAX_RETRIES;
  const nextStatus = willRetry ? "retrying" : "failed";
  if (!canTransition(job.status, nextStatus)) return invalidTransitionResponse(job.status, nextStatus);

  let updated;
  if (willRetry) {
    // running -> retrying -> queued, dans la même requête : "retrying" est
    // un état réel (visible dans l'historique via l'évènement ci-dessous)
    // mais ne reste jamais bloqué en base -- le job redevient immédiatement
    // réclamable par n'importe quel worker de la même agence.
    if (!canTransition("retrying", "queued")) throw new Error("transition retrying -> queued mal configurée");
    updated = await sql`
      UPDATE vehicle_jobs
      SET status = 'queued', worker_id = NULL, claimed_at = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
          retry_count = retry_count + 1
      WHERE id = ${id} AND worker_id = ${worker.id} AND status = ${job.status}
      RETURNING id, status, retry_count
    `;
  } else {
    updated = await sql`
      UPDATE vehicle_jobs SET status = 'failed', completed_at = now()
      WHERE id = ${id} AND worker_id = ${worker.id} AND status = ${job.status}
      RETURNING id, status, retry_count
    `;
  }
  if (!updated[0]) return invalidTransitionResponse(job.status, nextStatus);

  await sql`
    INSERT INTO job_events (vehicle_job_id, level, step, message)
    VALUES (${id}, 'error', ${step || null}, ${message + (willRetry ? ` (nouvelle tentative ${job.retry_count + 1}/${MAX_RETRIES})` : " (échec définitif)")})
  `;

  return new Response(JSON.stringify({ vehicle_job: updated[0], retried: willRetry }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const config = { path: "/api/agent/jobs/:id/fail" };
