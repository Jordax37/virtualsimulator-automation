-- Pré-provisionne la ligne du premier administrateur, AVANT sa première
-- connexion Netlify Identity (voir la règle de liaison dans
-- lib/user-auth.mjs : identity_id reste NULL jusqu'à la première connexion
-- réussie, liée par email -- jamais de création automatique de rôle).
-- ON CONFLICT : idempotent, cette migration ne s'applique qu'une fois de
-- toute façon, mais reste sûre si rejouée manuellement.

INSERT INTO users (email, role, agency_id)
VALUES ('j.lenestour45@gmail.com', 'administrateur', NULL)
ON CONFLICT (email) DO NOTHING;
