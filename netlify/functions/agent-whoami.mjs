// Endpoint de vérification pour un agent local (extension/futur agent) :
// confirme que son token est valide et actif, et lui indique son agence.
// Sert aussi de test de bout en bout pour l'authentification worker.

import { getDatabase } from "@netlify/database";
import { authenticateWorker, unauthorizedResponse } from "./lib/worker-auth.mjs";

export default async (req) => {
  const { sql } = getDatabase();
  const worker = await authenticateWorker(sql, req.headers.get("authorization"));
  if (!worker) return unauthorizedResponse();

  return new Response(JSON.stringify({ ok: true, worker }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
