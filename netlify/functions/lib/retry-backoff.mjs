// Backoff simple avant qu'un job 'retrying' ne redevienne 'queued' -- évite
// qu'une erreur répétitive ne boucle instantanément (claim/fail en rafale
// sur le même véhicule). Pas de système plus complexe pour l'instant.
export const MAX_RETRIES = 3; // tentative initiale + 3 nouvelles tentatives avant 'failed'

// retryNumber = la Nième nouvelle tentative (1, 2, 3...) -- correspond à
// retry_count APRÈS incrémentation lors de cet échec.
const BACKOFF_MINUTES_BY_RETRY = { 1: 1, 2: 5, 3: 15 };

export function backoffMinutesFor(retryNumber) {
  return BACKOFF_MINUTES_BY_RETRY[retryNumber] ?? BACKOFF_MINUTES_BY_RETRY[MAX_RETRIES];
}
