// Authentification des utilisateurs humains (Netlify Identity) -- séparée à
// dessein de l'auth worker (voir worker-auth.mjs). Les agents locaux
// n'utilisent JAMAIS ce module, et réciproquement.
//
// Utilise l'API officielle actuelle @netlify/identity (getUser()) plutôt que
// de lire manuellement context.clientContext.user -- cette dernière forme
// n'était qu'une hypothèse jamais confirmée sur ce projet ; getUser() est la
// méthode documentée et recommandée par Netlify, compatible avec les
// fonctions v2 (export default) utilisées ici.
//
// RÈGLE DE SOURCE DE VÉRITÉ (imposée explicitement) :
// Netlify Identity = authentification (qui est cette personne).
// Notre table `users` = autorisation métier (ce qu'elle a le droit de faire).
// Le rôle/l'agence utilisés pour autoriser une route viennent TOUJOURS de
// `users.role` / `users.agency_id`, jamais de `identityUser.role` ni
// `identityUser.roles` (app_metadata) -- même si Identity permet aussi de
// stocker un rôle, on ne veut qu'une seule source de vérité métier pour
// éviter un désaccord du type Identity=manager / DB=commercial.
//
// ⚠️ NON TESTÉ -- nécessite Netlify Identity activé en production. La forme
// des champs de l'objet User (id, email, role, roles, appMetadata...) est
// documentée par @netlify/identity mais jamais observée en conditions
// réelles sur CE site tant qu'Identity n'est pas activé.

import { getUser } from "@netlify/identity";

// Résout l'utilisateur applicatif (role/agency_id) à partir de l'utilisateur
// Identity authentifié. getUser() vérifie déjà l'authenticité (JWT) auprès
// de la plateforme/API Identity -- ce module ne revérifie aucune signature,
// il ne fait que lire un résultat déjà digne de confiance.
//
// Logique de liaison, dans cet ordre STRICT :
// 1. identity_id déjà connu en base -> renvoie directement la ligne. Ce cas
//    est TOUJOURS prioritaire et définitif : si une ligne a déjà un
//    identity_id, on ne retombe JAMAIS sur une correspondance par email,
//    même si l'email a changé depuis côté Identity (identity_id reste la
//    seule référence d'identité une fois la liaison faite -- l'email
//    pourra être resynchronisé séparément si besoin, mais ne sert plus à
//    l'identification).
// 2. Sinon (identity_id inconnu), cherche une ligne PRÉ-CRÉÉE par un
//    administrateur pour cet email (identity_id encore NULL) et lie
//    identity_id à cette occasion -- la toute première fois seulement.
// 3. Aucune correspondance -> compte non provisionné, accès refusé. Ne crée
//    JAMAIS de ligne automatiquement ici, quel que soit le contenu du JWT :
//    le rôle et l'agence ne peuvent venir que d'une action d'administration
//    préalable, jamais d'une auto-inscription.
export async function getAuthenticatedUser(sql) {
  // ⚠️ getUser() lui-même ne peut être invoqué que dans une vraie exécution
  // Netlify Functions (lit un contexte de requête interne à la plateforme) --
  // NON TESTABLE hors production avec Identity activé.
  const identityUser = await getUser();
  if (!identityUser || !identityUser.email) return null;
  return resolveUserByIdentity(sql, identityUser.id, identityUser.email);
}

// Logique de liaison seule, isolée de getUser() pour rester testable
// indépendamment (voir le script de test : simule identityId/email sans
// dépendre du runtime Identity réel). Ordre STRICT :
// 1. identity_id déjà connu en base -> renvoie directement la ligne. Ce cas
//    est TOUJOURS prioritaire et définitif : si une ligne a déjà un
//    identity_id, on ne retombe JAMAIS sur une correspondance par email,
//    même si l'email a changé depuis côté Identity (identity_id reste la
//    seule référence d'identité une fois la liaison faite -- l'email
//    pourra être resynchronisé séparément si besoin, mais ne sert plus à
//    l'identification).
// 2. Sinon (identity_id inconnu), cherche une ligne PRÉ-CRÉÉE par un
//    administrateur pour cet email (identity_id encore NULL) et lie
//    identity_id à cette occasion -- la toute première fois seulement.
// 3. Aucune correspondance -> compte non provisionné, accès refusé. Ne crée
//    JAMAIS de ligne automatiquement ici : le rôle et l'agence ne peuvent
//    venir que d'une action d'administration préalable, jamais d'une
//    auto-inscription (voir aussi la future contrainte "Invite only").
export async function resolveUserByIdentity(sql, identityId, email) {
  const byIdentity = await sql`
    SELECT id, identity_id, email, role, agency_id FROM users WHERE identity_id = ${identityId}
  `;
  if (byIdentity[0]) return toUser(byIdentity[0]);

  const pending = await sql`
    SELECT id, identity_id, email, role, agency_id
    FROM users
    WHERE email = ${email} AND identity_id IS NULL
  `;
  if (!pending[0]) return null; // compte non provisionné par un administrateur

  const linked = await sql`
    UPDATE users SET identity_id = ${identityId}
    WHERE id = ${pending[0].id}
    RETURNING id, identity_id, email, role, agency_id
  `;
  return toUser(linked[0]);
}

function toUser(row) {
  return { id: row.id, identityId: row.identity_id, email: row.email, role: row.role, agencyId: row.agency_id };
}

// À appeler explicitement dans CHAQUE fonction /api/admin/* -- masquer un
// bouton côté client n'est que de l'UX, jamais une protection réelle.
export function requireRole(user, allowedRoles) {
  return !!user && allowedRoles.includes(user.role);
}

export function unauthenticatedResponse() {
  return new Response(JSON.stringify({ error: "Authentification requise" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

export function forbiddenResponse(reason) {
  return new Response(JSON.stringify({ error: reason || "Accès refusé pour ce rôle" }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}
