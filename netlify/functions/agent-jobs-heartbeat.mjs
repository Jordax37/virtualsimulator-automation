// POST /api/agent/jobs/:id/heartbeat -- prolonge le bail (lease_expires_at),
// met à jour heartbeat_at et last_seen_at du worker. Ne change pas le
// statut. Uniquement pour le worker propriétaire du job, et seulement tant
// que le job n'est pas dans un état terminal.

import { getDatabase } from "@netlify/database";
import { authenticateWorker, unauthorizedResponse } from "./lib/worker-auth.mjs";

const LEASE_MINUTES = 5;
const NON_TERMINAL = ["claimed", "running", "action_required"];

export default async (req, context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers: { "Content-Type": "application/json" } });
  }
  const { sql } = getDatabase();
  const worker = await authenticateWorker(sql, req.headers.get("authorization"));
  if (!worker) return unauthorizedResponse();

  const { id } = context.params;
  const updated = await sql`
    UPDATE vehicle_jobs
    SET heartbeat_at = now(), lease_expires_at = now() + make_interval(mins => ${LEASE_MINUTES})
    WHERE id = ${id} AND worker_id = ${worker.id} AND status = ANY(${NON_TERMINAL})
    RETURNING id, status, heartbeat_at, lease_expires_at
  `;
  if (!updated[0]) {
    return new Response(JSON.stringify({ error: "Job introuvable, non détenu par ce worker, ou déjà terminé" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  await sql`UPDATE workers SET last_seen_at = now() WHERE id = ${worker.id}`;
  return new Response(JSON.stringify({ vehicle_job: updated[0] }), { status: 200, headers: { "Content-Type": "application/json" } });
};

export const config = { path: "/api/agent/jobs/:id/heartbeat" };
