-- Crée l'agence Virtual Orléans et son premier worker (le PC agence qui
-- fait tourner l'extension Chrome). Le token_hash ci-dessous est le SHA-256
-- du token brut généré une seule fois côté client (jamais stocké en clair,
-- voir lib/worker-auth.mjs) -- le token lui-même a été communiqué séparément
-- pour configurer l'extension, il n'apparaît jamais ici ni dans Git.

INSERT INTO agencies (name, code)
VALUES ('Virtual Orléans', 'orleans')
ON CONFLICT (code) DO NOTHING;

INSERT INTO workers (name, agency_id, token_hash)
SELECT 'ORLEANS-PC-01', a.id, 'e67570934b99c803ef76848b453ef037154b69571499f6fd8889202143774003'
FROM agencies a WHERE a.code = 'orleans'
ON CONFLICT (token_hash) DO NOTHING;
