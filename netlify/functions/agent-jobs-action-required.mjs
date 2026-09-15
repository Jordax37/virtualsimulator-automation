// POST /api/agent/jobs/:id/action-required -- running -> action_required.
// Le job reste attribué au même worker (utile pour CAPTCHA/corrections
// manuelles à faire sur CE poste précis).

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

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Corps JSON invalide" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  const { step, message } = body;
  if (!message) return new Response(JSON.stringify({ error: "message requis" }), { status: 400, headers: { "Content-Type": "application/json" } });

  const { id } = context.params;
  const rows = await sql`SELECT id, status FROM vehicle_jobs WHERE id = ${id} AND worker_id = ${worker.id}`;
  const job = rows[0];
  if (!job) return new Response(JSON.stringify({ error: "Job introuvable ou non détenu par ce worker" }), { status: 404, headers: { "Content-Type": "application/json" } });
  if (!canTransition(job.status, "action_required")) return invalidTransitionResponse(job.status, "action_required");

  const updated = await sql`
    UPDATE vehicle_jobs SET status = 'action_required'
    WHERE id = ${id} AND worker_id = ${worker.id} AND status = ${job.status}
    RETURNING id, status
  `;
  if (!updated[0]) return invalidTransitionResponse(job.status, "action_required");

  await sql`
    INSERT INTO job_events (vehicle_job_id, level, step, message)
    VALUES (${id}, 'action_required', ${step || null}, ${message})
  `;
  return new Response(JSON.stringify({ vehicle_job: updated[0] }), { status: 200, headers: { "Content-Type": "application/json" } });
};

export const config = { path: "/api/agent/jobs/:id/action-required" };
