-- Ajout de la soumission publique de véhicules (onglet "Ajouter un véhicule"
-- du simulateur, ouvert sans connexion -- voir la discussion produit :
-- accessible à quiconque a le lien du simulateur, comme le reste du site).
--
-- batches.created_by est NOT NULL (référence users.id) : plutôt que
-- d'assouplir cette contrainte (utilisée ailleurs pour le contrôle d'accès
-- par propriétaire, ex: mustRestrictToOwnBatches), on rattache toutes les
-- soumissions publiques à UN SEUL utilisateur système dédié, qui ne se
-- connecte jamais (identity_id reste NULL pour toujours). L'agence RÉELLE
-- de destination reste portée par batches.agency_id (choisie par le
-- commercial dans le formulaire), indépendante de l'agence de cet
-- utilisateur système -- donc correctement filtrée par agencyScopeFor pour
-- les managers/administrateurs qui consultent le dashboard.
INSERT INTO users (email, role, agency_id)
VALUES ('soumissions-publiques@virtual.internal', 'commercial', NULL)
ON CONFLICT (email) DO NOTHING;

-- Nom du commercial tel que saisi dans le formulaire public (texte libre,
-- pas de compte réel derrière) -- affiché dans le dashboard à la place
-- du lien vers un vrai utilisateur pour ces batches-là.
ALTER TABLE batches ADD COLUMN IF NOT EXISTS submitted_by_name TEXT;
