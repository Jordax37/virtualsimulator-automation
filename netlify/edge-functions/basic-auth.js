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

export const config = { path: "/*" };
