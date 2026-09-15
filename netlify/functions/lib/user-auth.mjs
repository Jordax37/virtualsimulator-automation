// Authentification des utilisateurs humains (Netlify Identity) -- séparée à
// dessein de l'auth worker (voir worker-auth.mjs). Les agents locaux
// n'utilisent JAMAIS ce module, et réciproquement.
//
// ⚠️ NON TESTÉ -- nécessite Netlify Identity activé en production. `netlify
// dev` ne peut pas émuler la vérification d'un JWT Identity tant qu'Identity
// n'est pas réellement activé sur le site lié. À vérifier dès l'activation :
// forme exacte de `context.clientContext.user` pour les fonctions v2 (Request/
// Context, export default), les claims utilisées ici (`sub`, `email`) sont
// celles documentées par Netlify mais jamais observées en conditions réelles
// sur CE projet.

// Netlify vérifie la signature du JWT Identity avant d'invoquer la fonction :
// si `context.clientContext.user` est présent, l'authenticité est déjà
// garantie par la plateforme -- ce module ne revérifie pas la signature,
// il ne fait que lire le résultat.
export function getIdentityClaims(context) {
  return context?.clientContext?.user || null;
}

// Résout l'utilisateur applicatif (role/agency_id) à partir des claims
// Identity déjà vérifiées. Le navigateur ne transmet et ne peut transmettre
// aucun rôle/agence ici -- ces informations viennent EXCLUSIVEMENT de la
// table `users`, elle-même alimentée par une action d'administration (jamais
// par l'utilisateur lui-même, jamais par un auto-provisioning à la connexion).
//
// Logique de liaison à la première connexion :
// 1. identity_id déjà connu en base -> renvoie directement la ligne.
// 2. Sinon, cherche une ligne PRÉ-CRÉÉE par un administrateur pour cet email
//    (identity_id encore NULL) et lie identity_id à cette occasion.
// 3. Aucune correspondance -> compte non provisionné, accès refusé. Ne crée
//    JAMAIS de ligne automatiquement ici, quel que soit le contenu du JWT.
export async function getAuthenticatedUser(sql, context) {
  const claims = getIdentityClaims(context);
  if (!claims || !claims.email || !claims.sub) return null;

  const byIdentity = await sql`
    SELECT id, identity_id, email, role, agency_id FROM users WHERE identity_id = ${claims.sub}
  `;
  if (byIdentity[0]) return toUser(byIdentity[0]);

  const pending = await sql`
    SELECT id, identity_id, email, role, agency_id
    FROM users
    WHERE email = ${claims.email} AND identity_id IS NULL
  `;
  if (!pending[0]) return null; // compte non provisionné par un administrateur

  const linked = await sql`
    UPDATE users SET identity_id = ${claims.sub}
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
