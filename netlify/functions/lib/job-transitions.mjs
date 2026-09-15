// Transitions de statut autorisées pour vehicle_jobs -- centralisées ici,
// jamais laissées à la discrétion d'un endpoint individuel. Chaque route de
// mutation doit vérifier canTransition(statutActuel, statutVoulu) avant
// d'écrire, et l'UPDATE lui-même doit conditionner sur l'ancien statut
// attendu (WHERE status = $ancien) pour rester atomique -- deux requêtes
// concurrentes sur le même job ne doivent jamais toutes les deux réussir.
export const ALLOWED_TRANSITIONS = {
  queued: ["claimed", "cancelled"],
  claimed: ["running", "queued", "cancelled"], // queued : le claim n'a pas été suivi d'un start à temps (bail expiré)
  running: ["action_required", "retrying", "completed", "failed", "cancelled"],
  action_required: ["running", "cancelled"], // resume, uniquement par le même worker
  retrying: ["queued", "cancelled"],
  completed: [], // terminal
  failed: [], // terminal
  cancelled: [], // terminal
};

export function canTransition(from, to) {
  return (ALLOWED_TRANSITIONS[from] || []).includes(to);
}

export function invalidTransitionResponse(from, to) {
  return new Response(JSON.stringify({ error: `Transition invalide : ${from} -> ${to}` }), {
    status: 409,
    headers: { "Content-Type": "application/json" },
  });
}
