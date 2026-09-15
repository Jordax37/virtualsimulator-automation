export default async (request, context) => {
  const user = Netlify.env.get("BASIC_AUTH_USER");
  const pass = Netlify.env.get("BASIC_AUTH_PASS");

  // Aucun fallback codé en dur : si l'une des deux variables n'est pas
  // configurée côté Netlify, l'accès est refusé plutôt que de retomber sur
  // un couple identifiant/mot de passe par défaut connu de quiconque lit ce
  // fichier (voir correction demandée avant mise en production).
  if (!user || !pass) {
    return new Response("Authentification non configurée.", { status: 401 });
  }

  const expected = "Basic " + btoa(`${user}:${pass}`);

  const auth = request.headers.get("authorization");
  if (auth !== expected) {
    return new Response("Authentification requise.", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Virtual Orleans", charset="UTF-8"',
      },
    });
  }

  return context.next();
};

// Seul /api/agent/* est exclu -- les agents locaux (extension Chrome)
// s'authentifient par leur propre token (Bearer), jamais par ce mot de passe
// partagé destiné aux humains (sans cette exclusion, le token agent ne
// suffit jamais à passer ce mur, avant même d'atteindre la fonction qui le
// vérifie -- vérifié en conditions réelles).
// /api/admin/* reste volontairement DERRIÈRE ce mur pour l'instant (double
// protection temporaire pendant la migration, voir le point dédié) --
// ERREUR CORRIGÉE ICI : une première version excluait "/api/*" en bloc, ce
// qui laissait /api/admin/* passer sans mot de passe partagé ; constaté en
// testant explicitement ce cas précis (content-type json de ma propre
// fonction au lieu du texte brut de cet edge function).
export const config = { path: "/*", excludedPath: ["/api/agent/*"] };
