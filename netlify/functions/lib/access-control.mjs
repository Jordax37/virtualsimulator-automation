// Règles d'accès /api/admin/* -- centralisées ici pour éviter qu'une route
// réimplémente sa propre logique de portée par agence et diverge des autres.
// Toujours basé sur `user.role`/`user.agencyId` résolus par
// getAuthenticatedUser() (table `users`), jamais sur une donnée du client.

// Portée agence pour une liste (users/workers/batches/jobs) : null = aucune
// restriction (administrateur, toutes agences), sinon l'id d'agence auquel
// il faut restreindre la requête (manager/commercial : uniquement la leur).
export function agencyScopeFor(user) {
  return user.role === "administrateur" ? null : user.agencyId;
}

// Gestion utilisateurs/workers : administrateur (toutes agences) et manager
// (sa propre agence, déjà appliquée via agencyScopeFor) seulement --
// commercial n'a aucun accès à la gestion des collaborateurs.
export function canManageCollaborators(user) {
  return user.role === "administrateur" || user.role === "manager";
}

// Un manager ne peut préparer un compte que pour SA PROPRE agence, et ne
// peut jamais accorder le rôle "administrateur" (seul un administrateur le
// peut) -- limite le risque d'élévation de privilège via ce formulaire.
export function canAssignRoleAndAgency(actingUser, targetRole, targetAgencyId) {
  if (actingUser.role === "administrateur") return true;
  if (actingUser.role !== "manager") return false;
  if (targetRole === "administrateur") return false;
  return targetAgencyId === actingUser.agencyId;
}

// Un commercial ne voit que les jobs issus de SES PROPRES batches, en plus
// de la restriction d'agence déjà appliquée par agencyScopeFor.
export function mustRestrictToOwnBatches(user) {
  return user.role === "commercial";
}
