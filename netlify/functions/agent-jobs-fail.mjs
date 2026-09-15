// POST /api/agent/jobs/:id/fail -- running -> retrying (avec backoff via
// next_retry_at, jamais requeued immédiatement) OU running -> failed. Le
// SERVEUR décide seul via retry_count, jamais l'extension : retryable=true
// dans le corps n'est qu'une indication.
//
// La transition retrying -> queued n'a JAMAIS lieu ici : elle est faite par
// la fonction planifiée de reprise (lease-recovery), une fois next_retry_at
// dépassé -- évite qu'une erreur répétitive ne boucle instantanément
// (claim/fail/queued/claim/fail... en rafale).

import { getDatabase } from "@netlify/database";
import { authenticateWorker, unauthorizedResponse } from "./lib/worker-auth.mjs";
import { canTransition, invalidTransitionResponse } from "./lib/job-transitions.mjs";
import { MAX_RETRIES, backoffMinutesFor } from "./lib/retry-backoff.mjs";

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
  let backoffMinutes;
  if (willRetry) {
    const nextRetryNumber = job.retry_count + 1;
    backoffMinutes = backoffMinutesFor(nextRetryNumber);
    // Le job quitte le worker (worker_id NULL) : un autre poste de la même
    // agence pourra le reprendre une fois next_retry_at dépassé, pas
    // nécessairement celui qui a échoué.
    updated = await sql`
      UPDATE vehicle_jobs
      SET status = 'retrying', worker_id = NULL, claimed_at = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
          retry_count = ${nextRetryNumber}, next_retry_at = now() + make_interval(mins => ${backoffMinutes})
      WHERE id = ${id} AND worker_id = ${worker.id} AND status = ${job.status}
      RETURNING id, status, retry_count, next_retry_at
    `;
  } else {
    updated = await sql`
      UPDATE vehicle_jobs SET status = 'failed', completed_at = now()
      WHERE id = ${id} AND worker_id = ${worker.id} AND status = ${job.status}
      RETURNING id, status, retry_count
    `;
  }
  if (!updated[0]) return invalidTransitionResponse(job.status, nextStatus);

  const eventMessage = willRetry
    ? `${message} (nouvelle tentative ${job.retry_count + 1}/${MAX_RETRIES} programmée dans ${backoffMinutes} min)`
    : `${message} (échec définitif après ${job.retry_count} tentative(s))`;
  await sql`INSERT INTO job_events (vehicle_job_id, level, step, message) VALUES (${id}, 'error', ${step || null}, ${eventMessage})`;

  return new Response(JSON.stringify({ vehicle_job: updated[0], retried: willRetry }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const config = { path: "/api/agent/jobs/:id/fail" };
