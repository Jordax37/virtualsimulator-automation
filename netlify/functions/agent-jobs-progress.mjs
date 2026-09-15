// POST /api/agent/jobs/:id/progress -- met à jour current_step si fourni,
// ajoute un job_event, garde le job attaché au worker authentifié. Ne
// change pas le statut lui-même (action-required/complete/fail s'en
// chargent).

import { getDatabase } from "@netlify/database";
import { authenticateWorker, unauthorizedResponse } from "./lib/worker-auth.mjs";

const VALID_STEPS = ["source", "extraction", "normalization", "photos", "vision", "compositing", "iziscar", "pdf", "zoho"];
const VALID_LEVELS = ["info", "ok", "error", "action_required"];

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
  const { step, message, level, progress_current, progress_total } = body;
  if (!message) return new Response(JSON.stringify({ error: "message requis" }), { status: 400, headers: { "Content-Type": "application/json" } });
  if (step && !VALID_STEPS.includes(step)) return new Response(JSON.stringify({ error: "step invalide" }), { status: 400, headers: { "Content-Type": "application/json" } });
  const finalLevel = VALID_LEVELS.includes(level) ? level : "info";

  const { id } = context.params;
  const jobRows = await sql`SELECT id, status FROM vehicle_jobs WHERE id = ${id} AND worker_id = ${worker.id}`;
  if (!jobRows[0]) {
    return new Response(JSON.stringify({ error: "Job introuvable ou non détenu par ce worker" }), { status: 404, headers: { "Content-Type": "application/json" } });
  }

  if (step) await sql`UPDATE vehicle_jobs SET current_step = ${step} WHERE id = ${id}`;

  const event = await sql`
    INSERT INTO job_events (vehicle_job_id, level, step, message, progress_current, progress_total)
    VALUES (${id}, ${finalLevel}, ${step || null}, ${message}, ${progress_current ?? null}, ${progress_total ?? null})
    RETURNING id, "timestamp", level, step, message, progress_current, progress_total
  `;
  return new Response(JSON.stringify({ event: event[0] }), { status: 201, headers: { "Content-Type": "application/json" } });
};

export const config = { path: "/api/agent/jobs/:id/progress" };
