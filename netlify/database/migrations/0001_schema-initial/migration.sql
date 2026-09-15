-- Schéma initial : espace admin/automatisation Virtual.
-- Un batch = un lancement utilisateur ; un vehicle_job = un véhicule/une URL.
-- Statut (cycle de vie) et étape (position dans le pipeline) sont deux
-- colonnes séparées, jamais mélangées.

-- gen_random_uuid() est native depuis PostgreSQL 13 -- vérifié sur la base
-- locale netlify dev, aucune extension (pgcrypto) requise ni disponible.

-- ---------------------------------------------------------------------
-- agencies
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE, -- ex: 'orleans', 'bordeaux'
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- users (comptes humains -- identité réelle gérée par Netlify Identity,
-- cette table stocke le rôle/l'agence associés à l'identity_id)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL tant que la personne ne s'est jamais connectée : un administrateur
  -- pré-provisionne la ligne (email + rôle + agence) AVANT que l'utilisateur
  -- n'existe côté Netlify Identity ; identity_id est rempli à la toute
  -- première connexion réussie, par correspondance sur l'email -- jamais de
  -- création automatique de ligne à la connexion (pas d'auto-attribution de
  -- rôle : voir la synchronisation dans lib/user-auth.mjs).
  identity_id TEXT UNIQUE,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('administrateur', 'manager', 'commercial')),
  agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_agency ON users(agency_id);

-- ---------------------------------------------------------------------
-- workers (agents locaux : extension Chrome ou futur agent Playwright --
-- authentification séparée des comptes humains, par token dédié révocable)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL, -- ex: 'ORLEANS-PC-01'
  agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL, -- SHA-256 du agent_token, jamais le token en clair
  last_seen_at TIMESTAMPTZ,
  version TEXT, -- version de l'extension/agent installée
  active BOOLEAN NOT NULL DEFAULT TRUE, -- passer à FALSE = révoquer le token
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workers_agency ON workers(agency_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workers_token_hash ON workers(token_hash);

-- ---------------------------------------------------------------------
-- batches (un lancement utilisateur, regroupe plusieurs vehicle_jobs)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  margin NUMERIC(10, 2), -- 1990 / 4990 / 0 -- NULL non autorisé côté appli, géré par l'API
  vehicule_us BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_batches_created_by ON batches(created_by);
CREATE INDEX IF NOT EXISTS idx_batches_agency ON batches(agency_id);

-- ---------------------------------------------------------------------
-- vehicle_jobs (un véhicule / une URL -- unité de travail réservable
-- atomiquement par un seul worker à la fois)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  source_domain TEXT, -- ex: 'mobile.de', déduit de source_url à la création

  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'claimed', 'running', 'action_required', 'paused', 'retrying', 'completed', 'failed', 'cancelled')
  ),
  current_step TEXT CHECK (
    current_step IS NULL OR current_step IN
      ('source', 'extraction', 'normalization', 'photos', 'vision', 'compositing', 'iziscar', 'pdf', 'zoho')
  ),

  -- Réservation atomique par un worker (voir claim en base : UPDATE ... WHERE
  -- status='queued' ... FOR UPDATE SKIP LOCKED, jamais un simple SELECT+UPDATE
  -- séparés qui laisserait une fenêtre de course entre deux postes).
  -- RESTRICT (pas SET NULL) : traçabilité définitive du PC ayant traité
  -- chaque véhicule -- un worker ne se supprime jamais physiquement, il se
  -- désactive (active=false), donc cette contrainte ne devrait jamais bloquer
  -- d'usage normal, seulement empêcher une suppression accidentelle.
  worker_id UUID REFERENCES workers(id) ON DELETE RESTRICT,
  claimed_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ, -- au-delà, le job redevient réclamable même si status='running'
  heartbeat_at TIMESTAMPTZ,

  retry_count INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_vehicle_jobs_batch ON vehicle_jobs(batch_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_jobs_worker ON vehicle_jobs(worker_id);
-- Index général (status, created_at) -- sert le dashboard pour tout filtrage
-- par statut (ex: lister les 'action_required' ou 'failed', triés par date).
CREATE INDEX IF NOT EXISTS idx_vehicle_jobs_status_created ON vehicle_jobs(status, created_at);
-- Index partiel supplémentaire, plus étroit, dédié spécifiquement à la
-- requête de claim (ne porte que sur les lignes 'queued' -- plus petit et
-- plus rapide que l'index général ci-dessus pour ce cas précis).
CREATE INDEX IF NOT EXISTS idx_vehicle_jobs_claimable ON vehicle_jobs(status, created_at) WHERE status = 'queued';
-- Index partiel sur les baux -- lease_expires_at n'est pertinent que pour les
-- jobs 'claimed'/'running' (NULL sinon), sert le job de récupération des
-- baux expirés.
CREATE INDEX IF NOT EXISTS idx_vehicle_jobs_lease ON vehicle_jobs(lease_expires_at) WHERE status IN ('claimed', 'running');

-- ---------------------------------------------------------------------
-- job_events (journal de progression, équivalent persistant du log actuel
-- du popup -- jamais modifié après écriture, uniquement inséré)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_job_id UUID NOT NULL REFERENCES vehicle_jobs(id) ON DELETE CASCADE,
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now(),
  level TEXT NOT NULL CHECK (level IN ('info', 'ok', 'error', 'action_required')),
  step TEXT,
  message TEXT NOT NULL,
  progress_current INTEGER,
  progress_total INTEGER
);

CREATE INDEX IF NOT EXISTS idx_job_events_job ON job_events(vehicle_job_id, "timestamp");

-- ---------------------------------------------------------------------
-- job_results (résultat final -- une ligne par vehicle_job terminé)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_job_id UUID NOT NULL UNIQUE REFERENCES vehicle_jobs(id) ON DELETE CASCADE,
  vehicle_data JSONB, -- structure "vehicle" complète produite par structureVehicle()
  iziscar_status TEXT CHECK (iziscar_status IS NULL OR iziscar_status IN ('ok', 'failed', 'skipped')),
  pdf_status TEXT CHECK (pdf_status IS NULL OR pdf_status IN ('ok', 'failed', 'skipped')),
  zoho_status TEXT CHECK (zoho_status IS NULL OR zoho_status IN ('ok', 'failed', 'skipped')),
  result_data JSONB, -- infos complémentaires (liens PDF/Zoho, id véhicule Iziscar...)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
