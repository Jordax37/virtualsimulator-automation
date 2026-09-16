-- Rotation du token de ORLEANS-PC-01 : le PC agence de Jordan (identifié
-- comme une machine distincte du PC gaming qui héberge Ollama/rembg) n'avait
-- plus le token en clair configuré dans l'extension. Le token_hash ci-dessous
-- est le SHA-256 du nouveau token brut généré une seule fois côté client
-- (jamais stocké en clair, voir lib/worker-auth.mjs) -- le token lui-même a
-- été communiqué séparément pour configurer l'extension, il n'apparaît jamais
-- ici ni dans Git.

UPDATE workers
SET token_hash = '1a62d7d2d8eab674f9ff9011f9b47ad015e6fb7b712634ff79a30ca9f9e0388e'
WHERE name = 'ORLEANS-PC-01';
