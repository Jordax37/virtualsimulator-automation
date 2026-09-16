// POST /api/public/submissions/:id/cancel -- annule une soumission publique,
// SANS authentification (voir public-submit-vehicle.mjs pour le contexte).
// Sécurité : l'id est un UUID non devinable, jamais listé publiquement --
// seul l'auteur de la soumission le connaît (gardé dans son navigateur après
// la création). Volontairement plus restrictif que l'annulation admin
// (admin-jobs-cancel.mjs) : uniquement depuis 'queued', jamais un job déjà
// réclamé par un worker -- une requête anonyme ne doit jamais pouvoir
// interrompre un traitement déjà en cours.

import { getDatabase } from "@netlify/database";

export default async (req, context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Méthode non autorisée" }), { status: 405, headers: { "Content-Type": "application/json" } });
  }
  const { sql } = getDatabase();
  const { id } = context.params;

  const updated = await sql`
    UPDATE vehicle_jobs SET status = 'cancelled', completed_at = now()
    WHERE id = ${id} AND status = 'queued'
    RETURNING id, status
  `;
  if (!updated[0]) {
    return new Response(
      JSON.stringify({ error: "Soumission introuvable ou déjà prise en charge (annulation impossible)" }),
      { status: 409, headers: { "Content-Type": "application/json" } }
    );
  }

  await sql`INSERT INTO job_events (vehicle_job_id, level, step, message) VALUES (${id}, 'error', NULL, 'Annulé par le commercial (soumission publique)')`;

  return new Response(JSON.stringify({ vehicle_job: updated[0] }), { status: 200, headers: { "Content-Type": "application/json" } });
};

export const config = { path: "/api/public/submissions/:id/cancel" };
