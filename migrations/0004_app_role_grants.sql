GRANT USAGE ON SCHEMA public TO
  pkgcompass_public_reader,
  pkgcompass_metrics_writer,
  pkgcompass_lead_writer,
  pkgcompass_migration_owner;

REVOKE ALL PRIVILEGES ON TABLE public.metrics_current FROM
  PUBLIC,
  pkgcompass_public_reader,
  pkgcompass_metrics_writer,
  pkgcompass_lead_writer;
GRANT SELECT ON TABLE public.metrics_current TO pkgcompass_public_reader;
GRANT SELECT, INSERT, UPDATE ON TABLE public.metrics_current TO pkgcompass_metrics_writer;

REVOKE ALL PRIVILEGES ON TABLE public.lead_requests, public.rate_limits FROM
  PUBLIC,
  pkgcompass_public_reader,
  pkgcompass_metrics_writer,
  pkgcompass_lead_writer;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lead_requests, public.rate_limits
  TO pkgcompass_lead_writer;

DO $verify_app_role_grants$
DECLARE
  public_schema_oid oid := 'public'::regnamespace;
  metrics_oid oid := 'public.metrics_current'::regclass;
  leads_oid oid := 'public.lead_requests'::regclass;
  rate_limits_oid oid := 'public.rate_limits'::regclass;
  migration_owner_oid oid;
  migration_can_grant_usage boolean := false;
  public_schema_acl boolean := false;
  public_table_acl boolean := false;
BEGIN
  SELECT oid INTO migration_owner_oid FROM pg_roles WHERE rolname = 'pkgcompass_migration_owner';
  SELECT EXISTS (
    SELECT 1
    FROM pg_namespace AS namespace
    CROSS JOIN LATERAL aclexplode(COALESCE(namespace.nspacl, acldefault('n', namespace.nspowner))) AS acl
    WHERE namespace.oid = public_schema_oid
      AND acl.grantee = migration_owner_oid
      AND acl.privilege_type = 'USAGE'
      AND acl.is_grantable
  ) INTO migration_can_grant_usage;
  SELECT EXISTS (
    SELECT 1
    FROM pg_namespace AS namespace
    CROSS JOIN LATERAL aclexplode(COALESCE(namespace.nspacl, acldefault('n', namespace.nspowner))) AS acl
    WHERE namespace.oid = public_schema_oid AND acl.grantee = 0
  ) INTO public_schema_acl;
  SELECT EXISTS (
    SELECT 1
    FROM pg_class AS relation
    CROSS JOIN LATERAL aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) AS acl
    WHERE relation.oid = ANY(ARRAY[metrics_oid, leads_oid, rate_limits_oid]) AND acl.grantee = 0
  ) INTO public_table_acl;

  IF NOT migration_can_grant_usage OR public_schema_acl OR public_table_acl OR
    NOT has_schema_privilege('pkgcompass_migration_owner', 'public', 'CREATE') OR
    NOT has_schema_privilege('pkgcompass_public_reader', 'public', 'USAGE') OR
    NOT has_schema_privilege('pkgcompass_metrics_writer', 'public', 'USAGE') OR
    NOT has_schema_privilege('pkgcompass_lead_writer', 'public', 'USAGE') OR
    has_schema_privilege('pkgcompass_public_reader', 'public', 'CREATE') OR
    has_schema_privilege('pkgcompass_metrics_writer', 'public', 'CREATE') OR
    has_schema_privilege('pkgcompass_lead_writer', 'public', 'CREATE') OR
    NOT has_table_privilege('pkgcompass_public_reader', metrics_oid, 'SELECT') OR
    has_table_privilege('pkgcompass_public_reader', metrics_oid, 'INSERT') OR
    has_table_privilege('pkgcompass_public_reader', metrics_oid, 'UPDATE') OR
    has_table_privilege('pkgcompass_public_reader', metrics_oid, 'DELETE') OR
    NOT has_table_privilege('pkgcompass_metrics_writer', metrics_oid, 'SELECT') OR
    NOT has_table_privilege('pkgcompass_metrics_writer', metrics_oid, 'INSERT') OR
    NOT has_table_privilege('pkgcompass_metrics_writer', metrics_oid, 'UPDATE') OR
    has_table_privilege('pkgcompass_metrics_writer', metrics_oid, 'DELETE') OR
    has_table_privilege('pkgcompass_lead_writer', metrics_oid, 'SELECT') OR
    has_table_privilege('pkgcompass_lead_writer', metrics_oid, 'INSERT') OR
    has_table_privilege('pkgcompass_lead_writer', metrics_oid, 'UPDATE') OR
    has_table_privilege('pkgcompass_lead_writer', metrics_oid, 'DELETE') OR
    has_table_privilege('pkgcompass_public_reader', leads_oid, 'SELECT') OR
    has_table_privilege('pkgcompass_public_reader', leads_oid, 'INSERT') OR
    has_table_privilege('pkgcompass_public_reader', leads_oid, 'UPDATE') OR
    has_table_privilege('pkgcompass_public_reader', leads_oid, 'DELETE') OR
    has_table_privilege('pkgcompass_metrics_writer', leads_oid, 'SELECT') OR
    has_table_privilege('pkgcompass_metrics_writer', leads_oid, 'INSERT') OR
    has_table_privilege('pkgcompass_metrics_writer', leads_oid, 'UPDATE') OR
    has_table_privilege('pkgcompass_metrics_writer', leads_oid, 'DELETE') OR
    has_table_privilege('pkgcompass_public_reader', rate_limits_oid, 'SELECT') OR
    has_table_privilege('pkgcompass_public_reader', rate_limits_oid, 'INSERT') OR
    has_table_privilege('pkgcompass_public_reader', rate_limits_oid, 'UPDATE') OR
    has_table_privilege('pkgcompass_public_reader', rate_limits_oid, 'DELETE') OR
    has_table_privilege('pkgcompass_metrics_writer', rate_limits_oid, 'SELECT') OR
    has_table_privilege('pkgcompass_metrics_writer', rate_limits_oid, 'INSERT') OR
    has_table_privilege('pkgcompass_metrics_writer', rate_limits_oid, 'UPDATE') OR
    has_table_privilege('pkgcompass_metrics_writer', rate_limits_oid, 'DELETE') OR
    NOT has_table_privilege('pkgcompass_lead_writer', leads_oid, 'SELECT') OR
    NOT has_table_privilege('pkgcompass_lead_writer', leads_oid, 'INSERT') OR
    NOT has_table_privilege('pkgcompass_lead_writer', leads_oid, 'UPDATE') OR
    NOT has_table_privilege('pkgcompass_lead_writer', leads_oid, 'DELETE') OR
    NOT has_table_privilege('pkgcompass_lead_writer', rate_limits_oid, 'SELECT') OR
    NOT has_table_privilege('pkgcompass_lead_writer', rate_limits_oid, 'INSERT') OR
    NOT has_table_privilege('pkgcompass_lead_writer', rate_limits_oid, 'UPDATE') OR
    NOT has_table_privilege('pkgcompass_lead_writer', rate_limits_oid, 'DELETE')
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'PkgCompass database role grants failed verification';
  END IF;
END
$verify_app_role_grants$;
