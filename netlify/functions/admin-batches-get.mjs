// GET /api/admin/batches/:id -- détail d'un batch + ses vehicle_jobs.
// Contrôle d'accès par objet, pas seulement par liste.
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
  const rows = await sql`SELECT id, created_by, agency_id, margin, vehicule_us, created_at FROM batches WHERE id = ${id}`;
  const batch = rows[0];
  if (!batch) return new Response(JSON.stringify({ error: "Batch introuvable" }), { status: 404, headers: { "Content-Type": "application/json" } });

  if (user.role !== "administrateur" && batch.agency_id !== user.agencyId) {
    return forbiddenResponse("Ce batch n'appartient pas à votre agence");
  }
  if (mustRestrictToOwnBatches(user) && batch.created_by !== user.id) {
    return forbiddenResponse("Ce batch ne vous appartient pas");
  }

  // vehicle_data (marque/modèle/photos de référence, voir vehicleSummaryForServer
  // côté extension) sert uniquement à identifier visuellement le véhicule sur
  // le dashboard -- volontairement léger (jamais l'objet vehicle complet).
  const jobs = await sql`
    SELECT vj.id, vj.source_url, vj.source_domain, vj.status, vj.current_step, vj.worker_id, vj.retry_count,
      vj.created_at, vj.started_at, vj.completed_at, jr.vehicle_data
    FROM vehicle_jobs vj
    LEFT JOIN job_results jr ON jr.vehicle_job_id = vj.id
    WHERE vj.batch_id = ${id} ORDER BY vj.created_at
  `;
  return new Response(JSON.stringify({ batch, vehicle_jobs: jobs }), { status: 200, headers: { "Content-Type": "application/json" } });
};

export const config = { path: "/api/admin/batches/:id" };
