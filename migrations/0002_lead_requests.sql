CREATE TABLE public.lead_requests (
	request_id uuid PRIMARY KEY,
	dedup_key text NOT NULL CHECK (dedup_key ~ '^[0-9a-f]{64}$'),
	payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
	scenario text NOT NULL CHECK (scenario IN ('marketing_site', 'editorial_site', 'commerce_content')),
	contact_permission_version text NOT NULL CHECK (contact_permission_version = 'contact_v1'),
	contact_permission_at timestamptz NOT NULL,
	state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'accepted', 'failed')),
	conversion_id uuid NOT NULL DEFAULT gen_random_uuid(),
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	expires_at timestamptz NOT NULL,
	CONSTRAINT lead_requests_expires_at_30d CHECK (expires_at = created_at + interval '720 hours')
);
--> statement-breakpoint
CREATE UNIQUE INDEX lead_requests_accepted_dedup_key_unique
	ON public.lead_requests USING btree (dedup_key)
	WHERE state = 'accepted';
--> statement-breakpoint
CREATE INDEX lead_requests_expires_at_idx
	ON public.lead_requests USING btree (expires_at);
