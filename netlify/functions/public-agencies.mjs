// GET /api/public/agencies -- liste des agences actives, SANS authentification
// (contrairement à admin-agencies.mjs) : sert le menu déroulant du formulaire
// public "Ajouter un véhicule" du simulateur, accessible sans connexion.
// Lecture seule, aucune donnée sensible (juste nom + code d'agence).

import { getDatabase } from "@netlify/database";

export default async () => {
  const { sql } = getDatabase();
  const rows = await sql`SELECT id, name, code FROM agencies WHERE active = true ORDER BY name`;
  return new Response(JSON.stringify({ agencies: rows }), { status: 200, headers: { "Content-Type": "application/json" } });
};

export const config = { path: "/api/public/agencies" };
