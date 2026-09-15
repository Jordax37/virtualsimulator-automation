export default async (request, context) => {
  const user = Netlify.env.get("BASIC_AUTH_USER") || "virtual";
  const pass = Netlify.env.get("BASIC_AUTH_PASS") || "courtier";
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

// Exclut les routes API : les agents locaux (extension Chrome) s'authentifient
// par leur propre token (Bearer), jamais par ce mot de passe partagé destiné
// aux humains -- sans cette exclusion, le token agent ne suffit jamais à
// passer ce mur, avant même d'atteindre la fonction qui le vérifie
// (vérifié en conditions réelles : "Authentification requise." renvoyé par
// cet edge function AVANT que agent-whoami ne s'exécute).
export const config = { path: "/*", excludedPath: ["/api/*", "/.netlify/functions/*"] };
