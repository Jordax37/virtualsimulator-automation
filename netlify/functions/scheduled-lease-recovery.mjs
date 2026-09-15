// Fonction planifiée : récupère les jobs abandonnés (bail expiré) et fait
// passer les jobs 'retrying' arrivés à échéance vers 'queued'. Toutes les 5
// minutes -- suffisant vu que le bail lui-même dure 5 minutes et le backoff
// le plus court est de 1 minute.
//
// ⚠️ NON TESTÉ en tant que fonction PLANIFIÉE réelle (nécessite un déploiement
// production pour vérifier le déclenchement cron) -- la logique SQL sous-jacente
// est testée directement (voir le script de test dédié).

import { getDatabase } from "@netlify/database";
import { MAX_RETRIES, backoffMinutesFor } from "./lib/retry-backoff.mjs";

export default async () => {
  const { sql } = getDatabase();

  // --- 1. Baux expirés (claimed/running dont le worker a disparu) ---
  const expiredLeases = await sql`
    SELECT id, retry_count FROM vehicle_jobs
    WHERE status IN ('claimed', 'running') AND lease_expires_at < now()
  `;

  let recoveredToRetry = 0;
  let recoveredToFailed = 0;
  for (const job of expiredLeases) {
    const nextRetryNumber = job.retry_count + 1;
    if (nextRetryNumber > MAX_RETRIES) {
      // Message construit en JS SIMPLE d'abord, jamais interpolé directement
      // à l'intérieur d'une chaîne SQL du template sql`` -- une interpolation
      // ${...} au milieu d'un littéral déjà entre guillemets simples casse le
      // comptage des paramètres (constaté en conditions réelles : "bind
      // message supplies 4 parameters, but prepared statement requires 1").
      const message = `Agent perdu / bail expiré -- échec définitif après ${nextRetryNumber - 1} tentative(s)`;
      await sql`
        UPDATE vehicle_jobs
        SET status = 'failed', completed_at = now(), worker_id = NULL, claimed_at = NULL, heartbeat_at = NULL, lease_expires_at = NULL,
            retry_count = ${nextRetryNumber}
        WHERE id = ${job.id} AND status IN ('claimed', 'running')
      `;
      await sql`
        INSERT INTO job_events (vehicle_job_id, level, step, message)
        VALUES (${job.id}, 'error', NULL, ${message})
      `;
      recoveredToFailed++;
    } else {
      const backoffMinutes = backoffMinutesFor(nextRetryNumber);
      const message = `Agent perdu / bail expiré -- nouvelle tentative ${nextRetryNumber}/${MAX_RETRIES} programmée dans ${backoffMinutes} min`;
      await sql`
        UPDATE vehicle_jobs
        SET status = 'retrying', worker_id = NULL, claimed_at = NULL, heartbeat_at = NULL, lease_expires_at = NULL,
            retry_count = ${nextRetryNumber}, next_retry_at = now() + make_interval(mins => ${backoffMinutes})
        WHERE id = ${job.id} AND status IN ('claimed', 'running')
      `;
      await sql`
        INSERT INTO job_events (vehicle_job_id, level, step, message)
        VALUES (${job.id}, 'error', NULL, ${message})
      `;
      recoveredToRetry++;
    }
  }

  // --- 2. Retries dont le backoff est écoulé -> redeviennent réclamables ---
  const promoted = await sql`
    UPDATE vehicle_jobs SET status = 'queued', next_retry_at = NULL
    WHERE status = 'retrying' AND next_retry_at < now()
    RETURNING id
  `;

  return new Response(
    JSON.stringify({
      expired_leases_found: expiredLeases.length,
      recovered_to_retrying: recoveredToRetry,
      recovered_to_failed: recoveredToFailed,
      promoted_to_queued: promoted.length,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};

export const config = { schedule: "*/5 * * * *" };
