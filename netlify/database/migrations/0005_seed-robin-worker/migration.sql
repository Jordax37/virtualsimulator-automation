-- Ajoute le second worker (PC de Robin), même agence Virtual Orléans que
-- ORLEANS-PC-01. Le token_hash ci-dessous est le SHA-256 du token brut
-- généré une seule fois côté client (jamais stocké en clair, voir
-- lib/worker-auth.mjs) -- le token lui-même a été communiqué séparément
-- pour configurer l'extension, il n'apparaît jamais ici ni dans Git.

INSERT INTO workers (name, agency_id, token_hash)
SELECT 'ROBIN-PC', a.id, '3f734f2dde1bf9eb1a62c0fc42690c0bb82e0d7943d753a25130569e4a51bd1c'
FROM agencies a WHERE a.code = 'orleans'
ON CONFLICT (token_hash) DO NOTHING;
