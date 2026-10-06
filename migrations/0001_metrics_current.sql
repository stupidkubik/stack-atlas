CREATE TABLE public.metrics_current (
  product_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('npm', 'github')),
  metric text NOT NULL,
  source_entity_id text NOT NULL,
  source_identity text NOT NULL CHECK (length(source_identity) > 0),
  source_url text NOT NULL CHECK (source_url LIKE 'https://%'),
  last_attempt_at timestamptz NOT NULL,
  last_status text NOT NULL CHECK (last_status IN ('ok', 'error', 'unknown', 'not_applicable')),
  last_reason text,
  valid_value jsonb,
  valid_observed_at timestamptz,
  valid_fetched_at timestamptz,
  valid_period_start date,
  valid_period_end date,
  valid_series jsonb,
  run_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT current_timestamp,
  CONSTRAINT metrics_current_pk PRIMARY KEY (product_id, source, metric),
  CONSTRAINT metrics_current_metric_source_ck CHECK (
    (source = 'npm' AND metric = 'downloads_30d') OR
    (source = 'github' AND metric IN ('stars', 'open_issues', 'license'))
  ),
  CONSTRAINT metrics_current_valid_value_fields_ck CHECK (
    (valid_value IS NULL AND valid_observed_at IS NULL AND valid_fetched_at IS NULL) OR
    (valid_value IS NOT NULL AND valid_observed_at IS NOT NULL AND valid_fetched_at IS NOT NULL)
  ),
  CONSTRAINT metrics_current_period_ck CHECK (
    (source = 'npm' AND (valid_period_start IS NULL) = (valid_period_end IS NULL) AND
      (valid_period_start IS NULL OR valid_period_start <= valid_period_end)) OR
    (source = 'github' AND valid_period_start IS NULL AND valid_period_end IS NULL AND valid_series IS NULL)
  ),
  CONSTRAINT metrics_current_series_ck CHECK (
    valid_series IS NULL OR (source = 'npm' AND metric = 'downloads_30d' AND jsonb_typeof(valid_series) = 'array')
  ),
  CONSTRAINT metrics_current_last_status_ck CHECK (
    last_status <> 'ok' OR (valid_value IS NOT NULL AND valid_observed_at IS NOT NULL AND valid_fetched_at IS NOT NULL)
  )
);
