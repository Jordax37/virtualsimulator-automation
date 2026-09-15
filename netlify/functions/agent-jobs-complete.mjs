// POST /api/agent/jobs/:id/complete -- running -> completed. Écrit/met à
// jour job_results (upsert : un job ne peut avoir qu'un seul résultat,
// contrainte UNIQUE sur vehicle_job_id). Idempotent : un /complete rappelé
// par le MÊME worker sur un job déjà 'completed' ne recrée jamais un second
// résultat ni ne recompte -- il met juste à jour le résultat existant
// (ON CONFLICT) et renvoie un succès stable, sans toucher completed_at.

import { getDatabase } from "@netlify/database";
import { authenticateWorker, unauthorizedResponse } from "./lib/worker-auth.mjs";
import { canTransition, invalidTransitionResponse } from "./lib/job-transitions.mjs";

const VALID_SUBSTATUS = ["ok", "failed", "skipped"];

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
  const vehicleData = body.vehicle_data ?? null;
  const resultData = body.result_data ?? null;
  const iziscarStatus = VALID_SUBSTATUS.includes(body.iziscar_status) ? body.iziscar_status : null;
  const pdfStatus = VALID_SUBSTATUS.includes(body.pdf_status) ? body.pdf_status : null;
  const zohoStatus = VALID_SUBSTATUS.includes(body.zoho_status) ? body.zoho_status : null;

  const { id } = context.params;
  const rows = await sql`SELECT id, status, completed_at FROM vehicle_jobs WHERE id = ${id} AND worker_id = ${worker.id}`;
  const job = rows[0];
  if (!job) return new Response(JSON.stringify({ error: "Job introuvable ou non détenu par ce worker" }), { status: 404, headers: { "Content-Type": "application/json" } });

  // Idempotence : déjà completed par CE worker (retry réseau) -- ne refait
  // pas la transition (completed_at inchangé), mais laisse tout de même
  // l'upsert job_results ci-dessous rejouer sans dupliquer.
  const alreadyCompleted = job.status === "completed";
  if (!alreadyCompleted && !canTransition(job.status, "completed")) return invalidTransitionResponse(job.status, "completed");

  let jobResponse;
  if (alreadyCompleted) {
    jobResponse = { id: job.id, status: job.status, completed_at: job.completed_at };
  } else {
    const updated = await sql`
      UPDATE vehicle_jobs SET status = 'completed', completed_at = now()
      WHERE id = ${id} AND worker_id = ${worker.id} AND status = ${job.status}
      RETURNING id, status, completed_at
    `;
    if (!updated[0]) return invalidTransitionResponse(job.status, "completed");
    jobResponse = updated[0];
  }

  const result = await sql`
    INSERT INTO job_results (vehicle_job_id, vehicle_data, iziscar_status, pdf_status, zoho_status, result_data)
    VALUES (${id}, ${JSON.stringify(vehicleData)}, ${iziscarStatus}, ${pdfStatus}, ${zohoStatus}, ${JSON.stringify(resultData)})
    ON CONFLICT (vehicle_job_id) DO UPDATE SET
      vehicle_data = EXCLUDED.vehicle_data,
      iziscar_status = EXCLUDED.iziscar_status,
      pdf_status = EXCLUDED.pdf_status,
      zoho_status = EXCLUDED.zoho_status,
      result_data = EXCLUDED.result_data
    RETURNING id
  `;

  return new Response(JSON.stringify({ vehicle_job: jobResponse, job_result_id: result[0].id }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const config = { path: "/api/agent/jobs/:id/complete" };
