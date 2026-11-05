-- Five invented players for local runs and the engine's tests, signed up and confirmed, so the link
-- trigger fills players.user_id. `supabase db reset` loads this; production never does.

insert into public.players (email, role)
values
  ('sim-1@example.com', 'admin'),
  ('sim-2@example.com', 'player'),
  ('sim-3@example.com', 'player'),
  ('sim-4@example.com', 'player'),
  ('sim-5@example.com', 'player');

-- The empty tokens are what the auth server writes, and it cannot read a user with them null.
insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change,
  email_change_token_new
)
select
  ('00000000-0000-4000-8000-00000000000' || number)::uuid,
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'sim-' || number || '@example.com',
  now(),
  '{"provider": "email", "providers": ["email"]}',
  '{}',
  now(),
  now(),
  '',
  '',
  '',
  ''
from generate_series(1, 5) as number;
