// GET /api/admin/whoami -- confirme l'identité et le rôle de l'utilisateur
// humain connecté. Sert de brique de référence pour toutes les futures
// routes /api/admin/* : même schéma de vérification (Identity -> users ->
// rôle) à reproduire dans chacune, jamais une vérification côté client seule.
//
// ⚠️ PARTIELLEMENT TESTÉ : la résolution users/rôle (getAuthenticatedUser) est
// testée directement (voir le script de test), mais PAS la lecture réelle de
// context.clientContext.user par la plateforme Netlify -- nécessite Identity
// activé en production.

import { getDatabase } from "@netlify/database";
import { getAuthenticatedUser, unauthenticatedResponse } from "./lib/user-auth.mjs";

export default async (req, context) => {
  const { sql } = getDatabase();
  const user = await getAuthenticatedUser(sql, context);
  if (!user) return unauthenticatedResponse();

  return new Response(
    JSON.stringify({
      user_id: user.id,
      email: user.email,
      role: user.role,
      agency_id: user.agencyId,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};

export const config = { path: "/api/admin/whoami" };
