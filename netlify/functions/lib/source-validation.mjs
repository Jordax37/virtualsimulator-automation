// Validation des URLs source à la création d'un batch -- toujours calculée
// et vérifiée côté serveur, jamais une valeur source_domain envoyée par le
// navigateur (qui pourrait mentir sur le domaine réel de l'URL).
export const ALLOWED_SOURCE_DOMAINS = ["mobile.de", "autoscout24.net", "otomoto.pl", "autotrader.ca", "cars.com"];

// Retourne le domaine autorisé correspondant (ex: "mobile.de") si l'URL est
// valide, https, et appartient à un domaine autorisé (le domaine exact ou un
// sous-domaine, ex: "www.mobile.de" -> "mobile.de") -- sinon null.
export function validateSourceUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;

  const hostname = url.hostname.toLowerCase();
  return ALLOWED_SOURCE_DOMAINS.find((domain) => hostname === domain || hostname.endsWith("." + domain)) || null;
}
