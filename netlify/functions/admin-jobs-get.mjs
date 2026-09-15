// GET /api/admin/jobs/:id -- détail d'un vehicle_job. Contrôle d'accès par
// objet : administrateur (tout), manager (son agence), commercial (son
// agence ET uniquement les jobs issus de ses propres batches).
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
  // vehicle_data (marque/modèle/photos de référence, voir vehicleSummaryForServer
  // côté extension) sert uniquement à identifier visuellement le véhicule --
  // volontairement léger, jamais l'objet vehicle complet.
  const rows = await sql`
    SELECT vj.*, b.agency_id AS batch_agency_id, b.created_by AS batch_created_by, jr.vehicle_data
    FROM vehicle_jobs vj
    JOIN batches b ON b.id = vj.batch_id
    LEFT JOIN job_results jr ON jr.vehicle_job_id = vj.id
    WHERE vj.id = ${id}
  `;
  const job = rows[0];
  if (!job) return new Response(JSON.stringify({ error: "Job introuvable" }), { status: 404, headers: { "Content-Type": "application/json" } });

  if (user.role !== "administrateur" && job.batch_agency_id !== user.agencyId) {
    return forbiddenResponse("Ce job n'appartient pas à votre agence");
  }
  if (mustRestrictToOwnBatches(user) && job.batch_created_by !== user.id) {
    return forbiddenResponse("Ce job ne provient pas d'un de vos batches");
  }

  const { batch_agency_id, batch_created_by, ...jobFields } = job;
  return new Response(JSON.stringify({ vehicle_job: jobFields }), { status: 200, headers: { "Content-Type": "application/json" } });
};

export const config = { path: "/api/admin/jobs/:id" };
