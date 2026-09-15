// POST /api/agent/jobs/claim -- réservation atomique d'un vehicle_job pour
// le worker authentifié. queued -> claimed. Restreint à l'agence du worker
// authentifié (jamais un agency_id envoyé par le client) et aux workers
// actifs. FOR UPDATE SKIP LOCKED dans une seule instruction UPDATE (pas un
// SELECT puis un UPDATE séparés) -- voir la validation déjà faite sur cette
// requête précise.
//
// ⚠️ PARTIELLEMENT TESTÉ -- la requête SQL de claim est testée directement
// (voir échanges précédents) ; ce fichier lui-même (authenticateWorker +
// route) est testable de bout en bout sans dépendre d'Identity.

import { getDatabase } from "@netlify/database";
import { authenticateWorker, unauthorizedResponse } from "./lib/worker-auth.mjs";

const LEASE_MINUTES = 5;

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers: { "Content-Type": "application/json" } });
  }
  const { sql } = getDatabase();
  const worker = await authenticateWorker(sql, req.headers.get("authorization"));
  if (!worker) return unauthorizedResponse();

  const rows = await sql`
    UPDATE vehicle_jobs
    SET status = 'claimed', worker_id = ${worker.id}, claimed_at = now(),
        lease_expires_at = now() + make_interval(mins => ${LEASE_MINUTES}), heartbeat_at = now()
    WHERE id = (
      SELECT vj.id FROM vehicle_jobs vj
      JOIN batches b ON b.id = vj.batch_id
      WHERE vj.status = 'queued' AND b.agency_id = ${worker.agencyId}
      ORDER BY vj.created_at
      FOR UPDATE OF vj SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, batch_id, source_url, source_domain, status, claimed_at, lease_expires_at
  `;

  if (!rows[0]) {
    return new Response(JSON.stringify({ job: null, message: "Aucun job disponible pour votre agence" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ job: rows[0] }), { status: 200, headers: { "Content-Type": "application/json" } });
};

export const config = { path: "/api/agent/jobs/claim" };
