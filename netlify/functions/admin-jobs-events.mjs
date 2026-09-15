// GET /api/admin/jobs/:id/events -- journal de progression d'un vehicle_job.
// Même contrôle d'accès par objet que admin-jobs-get.mjs.
//
// ⚠️ PARTIELLEMENT TESTÉ -- voir la même remarque que admin-batches.mjs.

import { getDatabase } from "@netlify/database";
import { getAuthenticatedUser, unauthenticatedResponse, forbiddenResponse } from "./lib/user-auth.mjs";
import { mustRestrictToOwnBatches } from "./lib/access-control.mjs";

export default async (req, context) => {
  const { sql } = getDatabase();
  const user = await getAuthenticatedUser(sql);
  if (!user) return unauthenticatedResponse();

  const { id } = context.params;
  const jobRows = await sql`
    SELECT vj.id, b.agency_id AS batch_agency_id, b.created_by AS batch_created_by
    FROM vehicle_jobs vj JOIN batches b ON b.id = vj.batch_id
    WHERE vj.id = ${id}
  `;
  const job = jobRows[0];
  if (!job) return new Response(JSON.stringify({ error: "Job introuvable" }), { status: 404, headers: { "Content-Type": "application/json" } });

  if (user.role !== "administrateur" && job.batch_agency_id !== user.agencyId) {
    return forbiddenResponse("Ce job n'appartient pas à votre agence");
  }
  if (mustRestrictToOwnBatches(user) && job.batch_created_by !== user.id) {
    return forbiddenResponse("Ce job ne provient pas d'un de vos batches");
  }

  const events = await sql`
    SELECT id, "timestamp", level, step, message, progress_current, progress_total
    FROM job_events WHERE vehicle_job_id = ${id} ORDER BY "timestamp"
  `;
  return new Response(JSON.stringify({ events }), { status: 200, headers: { "Content-Type": "application/json" } });
};

export const config = { path: "/api/admin/jobs/:id/events" };
