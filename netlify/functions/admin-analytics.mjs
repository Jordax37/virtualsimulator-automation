// GET /api/admin/analytics -- agrégats pour le dashboard (compteurs par
// statut, répartition par agence, activité des workers). Même portée que
// les autres routes /api/admin/* : administrateur voit tout, manager sa
// propre agence, commercial uniquement ses propres batches. La répartition
// par agence n'est renvoyée qu'à un administrateur (données inter-agences) ;
// l'activité des workers, à administrateur/manager uniquement (même règle
// que la gestion des collaborateurs).

import { getDatabase } from "@netlify/database";
import { getAuthenticatedUser, unauthenticatedResponse } from "./lib/user-auth.mjs";
import { agencyScopeFor, mustRestrictToOwnBatches, canManageCollaborators } from "./lib/access-control.mjs";

async function getBatchCount(sql, user) {
  if (mustRestrictToOwnBatches(user)) {
    return (await sql`SELECT COUNT(*)::int AS count FROM batches WHERE created_by = ${user.id}`)[0].count;
  }
  const scopeAgencyId = agencyScopeFor(user);
  if (scopeAgencyId) {
    return (await sql`SELECT COUNT(*)::int AS count FROM batches WHERE agency_id = ${scopeAgencyId}`)[0].count;
  }
  return (await sql`SELECT COUNT(*)::int AS count FROM batches`)[0].count;
}

async function getByStatusCounts(sql, user) {
  if (mustRestrictToOwnBatches(user)) {
    return await sql`
      SELECT vj.status, COUNT(*)::int AS count
      FROM vehicle_jobs vj JOIN batches b ON b.id = vj.batch_id
      WHERE b.created_by = ${user.id}
      GROUP BY vj.status
    `;
  }
  const scopeAgencyId = agencyScopeFor(user);
  if (scopeAgencyId) {
    return await sql`
      SELECT vj.status, COUNT(*)::int AS count
      FROM vehicle_jobs vj JOIN batches b ON b.id = vj.batch_id
      WHERE b.agency_id = ${scopeAgencyId}
      GROUP BY vj.status
    `;
  }
  return await sql`SELECT status, COUNT(*)::int AS count FROM vehicle_jobs GROUP BY status`;
}

async function getAgencyBreakdown(sql) {
  return await sql`
    SELECT a.id, a.name,
      COUNT(DISTINCT b.id)::int AS batches,
      COUNT(vj.id)::int AS jobs,
      COUNT(vj.id) FILTER (WHERE vj.status = 'completed')::int AS completed
    FROM agencies a
    LEFT JOIN batches b ON b.agency_id = a.id
    LEFT JOIN vehicle_jobs vj ON vj.batch_id = b.id
    GROUP BY a.id, a.name
    ORDER BY a.name
  `;
}

async function getWorkerBreakdown(sql, user) {
  const scopeAgencyId = agencyScopeFor(user);
  if (scopeAgencyId) {
    return await sql`
      SELECT w.id, w.name, w.agency_id, w.active, w.last_seen_at,
        COUNT(vj.id) FILTER (WHERE vj.status = 'completed')::int AS completed_count
      FROM workers w LEFT JOIN vehicle_jobs vj ON vj.worker_id = w.id
      WHERE w.agency_id = ${scopeAgencyId}
      GROUP BY w.id ORDER BY w.name
    `;
  }
  return await sql`
    SELECT w.id, w.name, w.agency_id, w.active, w.last_seen_at,
      COUNT(vj.id) FILTER (WHERE vj.status = 'completed')::int AS completed_count
    FROM workers w LEFT JOIN vehicle_jobs vj ON vj.worker_id = w.id
    GROUP BY w.id ORDER BY w.name
  `;
}

export default async (req) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers: { "Content-Type": "application/json" } });
  }
  const { sql } = getDatabase();
  const user = await getAuthenticatedUser(sql);
  if (!user) return unauthenticatedResponse();

  const [batches, statusRows, agencies, workers] = await Promise.all([
    getBatchCount(sql, user),
    getByStatusCounts(sql, user),
    user.role === "administrateur" ? getAgencyBreakdown(sql) : Promise.resolve([]),
    canManageCollaborators(user) ? getWorkerBreakdown(sql, user) : Promise.resolve([]),
  ]);

  const by_status = {};
  let vehicleJobs = 0;
  for (const row of statusRows) {
    by_status[row.status] = row.count;
    vehicleJobs += row.count;
  }

  return new Response(
    JSON.stringify({ totals: { batches, vehicle_jobs: vehicleJobs }, by_status, agencies, workers }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};

export const config = { path: "/api/admin/analytics" };
