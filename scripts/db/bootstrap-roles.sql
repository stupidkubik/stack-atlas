-- Run once with a database account allowed to create roles. Assign passwords separately.
-- These application login roles intentionally receive no schema or table grants here.
-- DP/LM migrations add exact object grants after their tables exist.
DO $bootstrap_roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pkgcompass_public_reader') THEN
    ALTER ROLE pkgcompass_public_reader WITH LOGIN NOCREATEDB NOCREATEROLE NOINHERIT;
  ELSE
    CREATE ROLE pkgcompass_public_reader WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pkgcompass_metrics_writer') THEN
    ALTER ROLE pkgcompass_metrics_writer WITH LOGIN NOCREATEDB NOCREATEROLE NOINHERIT;
  ELSE
    CREATE ROLE pkgcompass_metrics_writer WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pkgcompass_lead_writer') THEN
    ALTER ROLE pkgcompass_lead_writer WITH LOGIN NOCREATEDB NOCREATEROLE NOINHERIT;
  ELSE
    CREATE ROLE pkgcompass_lead_writer WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pkgcompass_migration_owner') THEN
    ALTER ROLE pkgcompass_migration_owner WITH LOGIN NOCREATEDB NOCREATEROLE NOINHERIT;
  ELSE
    CREATE ROLE pkgcompass_migration_owner WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END
$bootstrap_roles$;

-- Non-superuser administrators cannot ALTER superuser/replication/bypass-RLS
-- attributes even to FALSE. New roles set them explicitly; existing roles
-- must already have these attributes disabled.
DO $check_role_attributes$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = ANY(ARRAY[
      'pkgcompass_public_reader', 'pkgcompass_metrics_writer',
      'pkgcompass_lead_writer', 'pkgcompass_migration_owner'
    ]) AND (rolsuper OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'PkgCompass database roles must not have elevated role attributes';
  END IF;
END
$check_role_attributes$;

DO $check_role_memberships$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_auth_members AS membership
    WHERE (membership.roleid IN (
      SELECT oid FROM pg_roles WHERE rolname = ANY(ARRAY[
        'pkgcompass_public_reader',
        'pkgcompass_metrics_writer',
        'pkgcompass_lead_writer',
        'pkgcompass_migration_owner'
      ])
    ) OR membership.member IN (
      SELECT oid FROM pg_roles WHERE rolname = ANY(ARRAY[
        'pkgcompass_public_reader',
        'pkgcompass_metrics_writer',
        'pkgcompass_lead_writer',
        'pkgcompass_migration_owner'
      ])
    ))
    -- PostgreSQL 16+ automatically grants ADMIN-only membership to a
    -- non-superuser role creator. This does not let application roles
    -- inherit administrator privileges, or let the creator SET ROLE.
    AND NOT (
      membership.member = (SELECT oid FROM pg_roles WHERE rolname = current_user)
      AND membership.member NOT IN (
        SELECT oid FROM pg_roles WHERE rolname = ANY(ARRAY[
          'pkgcompass_public_reader',
          'pkgcompass_metrics_writer',
          'pkgcompass_lead_writer',
          'pkgcompass_migration_owner'
        ])
      )
      AND membership.admin_option
      AND NOT membership.inherit_option
      AND NOT membership.set_option
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'PkgCompass database roles must not have unexpected role memberships';
  END IF;
END
$check_role_memberships$;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO pkgcompass_migration_owner;

DO $migration_database_access$
BEGIN
  EXECUTE format('GRANT CREATE ON DATABASE %I TO pkgcompass_migration_owner', current_database());
END
$migration_database_access$;

-- ADMIN-only membership is insufficient for ALTER DEFAULT PRIVILEGES.
-- Switch to the migration owner just for its defaults, then restore the
-- creator's ADMIN-only membership before committing the bootstrap.
DO $migration_owner_switch$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    EXECUTE format('GRANT pkgcompass_migration_owner TO %I WITH INHERIT FALSE, SET TRUE', current_user);
  END IF;
END
$migration_owner_switch$;

SET ROLE pkgcompass_migration_owner;

ALTER DEFAULT PRIVILEGES FOR ROLE pkgcompass_migration_owner REVOKE ALL ON SCHEMAS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE pkgcompass_migration_owner REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE pkgcompass_migration_owner REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE pkgcompass_migration_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE pkgcompass_migration_owner REVOKE ALL ON TYPES FROM PUBLIC;

RESET ROLE;

DO $restore_creator_membership$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    -- Remove only our temporary grant. PostgreSQL's separate creator ADMIN
    -- grant remains intact, so future bootstrap/password operations work.
    EXECUTE format('REVOKE pkgcompass_migration_owner FROM %I GRANTED BY %I', current_user, current_user);
  END IF;
END
$restore_creator_membership$;
