// GET /api/agent/whoami -- vérifie le token d'un agent local (extension
// Chrome / futur agent) et lui confirme son identité/agence. Sert aussi de
// test de bout en bout pour l'authentification worker.

import { getDatabase } from "@netlify/database";
import { authenticateWorker, unauthorizedResponse } from "./lib/worker-auth.mjs";

export default async (req) => {
  const { sql } = getDatabase();
  const worker = await authenticateWorker(sql, req.headers.get("authorization"));
  if (!worker) return unauthorizedResponse();

  // Ne renvoie jamais token_hash (non sélectionné en base par
  // authenticateWorker de toute façon -- rien à filtrer ici par erreur).
  return new Response(
    JSON.stringify({
      worker_id: worker.id,
      name: worker.name,
      agency_id: worker.agencyId,
      agency_code: worker.agencyCode,
      active: worker.active,
      version: worker.version,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};

export const config = { path: "/api/agent/whoami" };
