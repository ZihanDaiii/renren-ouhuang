-- 两张表都开启 RLS 且不加任何策略：只有服务端用 service key 访问
create table public.wj_surveys (
  id bigint primary key, chain_id int not null, contract text not null, publisher text not null,
  token text not null, token_symbol text not null default 'MON', token_decimals int not null default 18,
  title text not null, intro text, author text, questions jsonb not null,
  total_pool text not null, max_slots int not null, deadline timestamptz not null,
  meta_hash text, admin_hash text not null, create_tx text, created_at timestamptz not null default now()
);
alter table public.wj_surveys enable row level security;

create table public.wj_responses (
  id uuid primary key default gen_random_uuid(),
  survey_id bigint not null references public.wj_surveys(id),
  device_id text not null, respondent text not null, status text not null default 'started',
  started_at timestamptz not null default now(), submitted_at timestamptz, duration_ms int,
  answers jsonb, qc jsonb, retry_count int not null default 0, answer_hash text, seed text,
  base text, lucky text, net text, claim_index int, tx_hash text, confirm_ms int,
  updated_at timestamptz not null default now(),
  unique (survey_id, device_id)
);
create index on public.wj_responses (survey_id, status);
alter table public.wj_responses enable row level security;
