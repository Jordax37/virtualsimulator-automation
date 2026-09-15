// POST /api/agent/jobs/:id/resume -- action_required -> running. Uniquement
// par le même worker (l'ownership check WHERE worker_id = $worker suffit à
// l'imposer, pas besoin de logique séparée).

import { getDatabase } from "@netlify/database";
import { authenticateWorker, unauthorizedResponse } from "./lib/worker-auth.mjs";
import { canTransition, invalidTransitionResponse } from "./lib/job-transitions.mjs";

const LEASE_MINUTES = 5;

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
  if (!canTransition(job.status, "running")) return invalidTransitionResponse(job.status, "running");

  const updated = await sql`
    UPDATE vehicle_jobs
    SET status = 'running', heartbeat_at = now(), lease_expires_at = now() + make_interval(mins => ${LEASE_MINUTES})
    WHERE id = ${id} AND worker_id = ${worker.id} AND status = ${job.status}
    RETURNING id, status
  `;
  if (!updated[0]) return invalidTransitionResponse(job.status, "running");
  return new Response(JSON.stringify({ vehicle_job: updated[0] }), { status: 200, headers: { "Content-Type": "application/json" } });
};

export const config = { path: "/api/agent/jobs/:id/resume" };
