// Authentification des agents locaux (extension Chrome / futur agent
// Playwright) -- séparée à dessein de Netlify Identity (comptes humains).
// Un agent s'authentifie par un token opaque, jamais par un email/mot de
// passe ni par une session Identity : voir la demande explicite de ne pas
// faire porter à l'extension la session d'un utilisateur humain.

import crypto from "node:crypto";

// 32 octets = 256 bits d'entropie, encodage base64url (compact, sûr dans un
// header Authorization, aucun caractère à échapper). Impossible à deviner :
// 2^256 possibilités.
export function generateAgentToken() {
  return crypto.randomBytes(32).toString("base64url");
}

// SHA-256 : jamais le token en clair en base, uniquement son empreinte.
// Un hash volé en base ne permet pas de reconstituer le token original.
export function hashToken(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function extractBearerToken(authorizationHeader) {
  if (!authorizationHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  return match ? match[1] : null;
}

// Authentifie un agent à partir de l'en-tête Authorization d'une requête.
// Le token n'est JAMAIS accepté ailleurs (query string, corps de requête) --
// uniquement via ce header, jamais journalisé (aucun `console.log` du token
// ou du header brut nulle part dans ce module ou ses appelants).
// Retourne le worker si le token est valide ET actif, sinon null -- jamais
// d'exception, à l'appelant de répondre 401 si null. Ne fait JAMAIS confiance
// à un agency_id envoyé par le client : l'agence du worker est TOUJOURS
// déduite du token côté serveur, via cette seule fonction.
export async function authenticateWorker(sql, authorizationHeader) {
  const token = extractBearerToken(authorizationHeader);
  if (!token) return null;

  const tokenHash = hashToken(token);
  const rows = await sql`
    SELECT w.id, w.name, w.agency_id, w.active, w.version, a.code AS agency_code
    FROM workers w
    JOIN agencies a ON a.id = w.agency_id
    WHERE w.token_hash = ${tokenHash}
  `;
  const worker = rows[0];
  if (!worker || !worker.active) return null;

  // Met à jour last_seen_at -- utile pour repérer un poste éteint depuis
  // longtemps depuis l'admin. Une erreur ici ne doit jamais faire échouer
  // l'authentification elle-même (le résultat sql`` de waddler n'est pas un
  // Promise natif chaînable en .catch(), d'où le try/await/catch explicite --
  // constaté en conditions réelles : TypeError "sql(...).catch is not a
  // function" avec le chaînage direct).
  try {
    await sql`UPDATE workers SET last_seen_at = now() WHERE id = ${worker.id}`;
  } catch {
    // non bloquant
  }

  return {
    id: worker.id,
    name: worker.name,
    agencyId: worker.agency_id,
    agencyCode: worker.agency_code,
    active: worker.active,
    version: worker.version,
  };
}

// Réponse 401 standard, réutilisée par toutes les fonctions protégées par
// un token agent.
export function unauthorizedResponse(reason) {
  return new Response(JSON.stringify({ error: reason || "Token agent invalide ou révoqué" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
