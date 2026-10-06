CREATE TABLE public.rate_limits (
	hit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	ip_hmac text NOT NULL CHECK (ip_hmac ~ '^[0-9a-f]{64}$'),
	occurred_at timestamptz NOT NULL DEFAULT now(),
	expires_at timestamptz NOT NULL CHECK (expires_at = occurred_at + interval '24 hours')
);
--> statement-breakpoint
CREATE INDEX rate_limits_ip_hmac_occurred_at_idx
	ON public.rate_limits USING btree (ip_hmac, occurred_at);
--> statement-breakpoint
CREATE INDEX rate_limits_expires_at_idx
	ON public.rate_limits USING btree (expires_at);
