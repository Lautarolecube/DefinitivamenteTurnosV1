-- Schema Supabase para Elite Aesthetic Clinics

create table if not exists pacientes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique,
  nombre text,
  apellido text,
  email text,
  telefono text,
  dni text,
  role text default 'paciente',
  created_at timestamptz default now()
);

-- Helper admin check
create or replace function is_admin()
returns boolean as $$
  select exists (
    select 1 from pacientes
    where user_id = auth.uid() and role = 'admin'
  );
$$ language sql stable;

create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.pacientes (user_id, email, role)
  values (new.id, new.email, 'paciente');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure handle_new_user();

create table if not exists profesionales (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  especialidad text,
  email text,
  telefono text,
  turnito_professional_key text,
  created_at timestamptz default now()
);

create table if not exists tratamientos_catalogo (
  id text primary key,
  nombre text not null,
  descripcion text,
  duration_min integer,
  precio numeric default 0,
  categoria text,
  requires_eval boolean default false,
  min_interval_days integer default 0,
  turnito_service_key text,
  turnito_url text,
  turnito_eval_url text,
  imagen_url text,
  activo boolean default true,
  comision_porcentaje numeric,
  comision_fija numeric,
  created_at timestamptz default now()
);

create table if not exists productos_venta (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  descripcion text,
  precio numeric default 0,
  benefit_label text,
  deposit_required boolean default false,
  deposit_amount numeric default 0,
  link_pago text,
  activo boolean default true,
  created_at timestamptz default now()
);

create table if not exists historial_clinico (
  id uuid primary key default gen_random_uuid(),
  paciente_id uuid references pacientes(id) on delete cascade,
  tratamiento_id text references tratamientos_catalogo(id),
  profesional_id uuid references profesionales(id),
  notas text,
  fecha timestamptz default now()
);

create table if not exists paciente_packs (
  id uuid primary key default gen_random_uuid(),
  paciente_id uuid references pacientes(id) on delete cascade,
  tratamiento_id text references tratamientos_catalogo(id),
  tratamiento_tipo text,
  total_sesiones integer not null,
  sesiones_restantes integer not null,
  status text default 'activo',
  last_used_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists caja_movimientos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,
  monto numeric not null,
  medio_pago text not null,
  concepto text,
  paciente_id uuid references pacientes(id),
  saldo_inicial numeric,
  created_at timestamptz default now()
);

create table if not exists agenda_turnos (
  id uuid primary key default gen_random_uuid(),
  google_event_id text,
  mp_payment_id text,
  fecha_inicio timestamptz not null,
  profesional text,
  tratamiento text,
  paciente_id uuid references pacientes(id),
  monto_sena numeric default 0,
  precio_total numeric default 0,
  estado_pago text default 'pendiente',
  created_at timestamptz default now()
);

create table if not exists inventario (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  producto text,
  stock_actual numeric default 0,
  stock_minimo numeric default 0,
  created_at timestamptz default now()
);

create table if not exists recetas_tratamiento (
  id uuid primary key default gen_random_uuid(),
  tratamiento_id text references tratamientos_catalogo(id) on delete cascade,
  insumo_id uuid references inventario(id) on delete cascade,
  cantidad numeric not null
);

create table if not exists comisiones_pendientes (
  id uuid primary key default gen_random_uuid(),
  profesional_id uuid references profesionales(id),
  tratamiento_id text references tratamientos_catalogo(id),
  monto numeric not null,
  status text default 'pendiente',
  created_at timestamptz default now()
);

create or replace function descontar_insumo(insumo_id uuid, cantidad numeric)
returns void as $$
begin
  update inventario
    set stock_actual = stock_actual - cantidad
    where id = insumo_id;
end;
$$ language plpgsql;

-- Optional: add paciente_id if table already existed before
alter table caja_movimientos
  add column if not exists paciente_id uuid references pacientes(id);

alter table caja_movimientos
  add column if not exists saldo_inicial numeric;

alter table paciente_packs
  add column if not exists tratamiento_tipo text;

alter table inventario
  add column if not exists producto text;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'agenda_select_admin' and tablename = 'agenda_turnos'
  ) then
    execute $q$
      create policy "agenda_select_admin"
      on agenda_turnos for select
      using (is_admin());
    $q$;
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'agenda_admin_all' and tablename = 'agenda_turnos'
  ) then
    execute $q$
      create policy "agenda_admin_all"
      on agenda_turnos for all
      using (is_admin()) with check (is_admin());
    $q$;
  end if;
end$$;

-- Optional: add turnito fields if tables already existed before
alter table profesionales
  add column if not exists turnito_professional_key text;

alter table tratamientos_catalogo
  add column if not exists descripcion text,
  add column if not exists duration_min integer,
  add column if not exists requires_eval boolean default false,
  add column if not exists min_interval_days integer default 0,
  add column if not exists turnito_service_key text,
  add column if not exists turnito_url text,
  add column if not exists turnito_eval_url text,
  add column if not exists imagen_url text,
  add column if not exists activo boolean default true;

alter table productos_venta
  add column if not exists link_pago text,
  add column if not exists activo boolean default true;

alter table agenda_turnos
  add column if not exists mp_payment_id text;
alter table agenda_turnos enable row level security;

-- RLS
alter table pacientes enable row level security;
alter table profesionales enable row level security;
alter table tratamientos_catalogo enable row level security;
alter table historial_clinico enable row level security;
alter table paciente_packs enable row level security;
alter table caja_movimientos enable row level security;
alter table inventario enable row level security;
alter table recetas_tratamiento enable row level security;
alter table comisiones_pendientes enable row level security;
alter table productos_venta enable row level security;

-- Pacientes
do $$
begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'pacientes_select_own_or_admin' and tablename = 'pacientes'
  ) then
    execute $q$
      create policy "pacientes_select_own_or_admin"
      on pacientes for select
      using (user_id = auth.uid() or is_admin());
    $q$;
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'pacientes_insert_self' and tablename = 'pacientes'
  ) then
    execute $q$
      create policy "pacientes_insert_self"
      on pacientes for insert
      with check (user_id = auth.uid());
    $q$;
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'pacientes_update_self_or_admin' and tablename = 'pacientes'
  ) then
    execute $q$
      create policy "pacientes_update_self_or_admin"
      on pacientes for update
      using (user_id = auth.uid() or is_admin())
      with check (user_id = auth.uid() or is_admin());
    $q$;
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'pacientes_delete_admin' and tablename = 'pacientes'
  ) then
    execute $q$
      create policy "pacientes_delete_admin"
      on pacientes for delete
      using (is_admin());
    $q$;
  end if;
end$$;

-- Catálogo y profesionales (lectura para autenticados)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'profesionales_select_auth' and tablename = 'profesionales'
  ) then
    execute $q$
      create policy "profesionales_select_auth"
      on profesionales for select
      using (auth.role() = 'authenticated' or is_admin());
    $q$;
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'profesionales_admin_all' and tablename = 'profesionales'
  ) then
    execute $q$
      create policy "profesionales_admin_all"
      on profesionales for all
      using (is_admin()) with check (is_admin());
    $q$;
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'tratamientos_catalogo_select_auth' and tablename = 'tratamientos_catalogo'
  ) then
    execute $q$
      create policy "tratamientos_catalogo_select_auth"
      on tratamientos_catalogo for select
      using (auth.role() in ('anon','authenticated') or is_admin());
    $q$;
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'tratamientos_catalogo_admin_all' and tablename = 'tratamientos_catalogo'
  ) then
    execute $q$
      create policy "tratamientos_catalogo_admin_all"
      on tratamientos_catalogo for all
      using (is_admin()) with check (is_admin());
    $q$;
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'productos_venta_select_public' and tablename = 'productos_venta'
  ) then
    execute $q$
      create policy "productos_venta_select_public"
      on productos_venta for select
      using (auth.role() in ('anon','authenticated') or is_admin());
    $q$;
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'productos_venta_admin_all' and tablename = 'productos_venta'
  ) then
    execute $q$
      create policy "productos_venta_admin_all"
      on productos_venta for all
      using (is_admin()) with check (is_admin());
    $q$;
  end if;
end$$;

-- Historial clínico
do $$
begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'historial_select_own_or_admin' and tablename = 'historial_clinico'
  ) then
    execute $q$
      create policy "historial_select_own_or_admin"
      on historial_clinico for select
      using (
        is_admin() or
        paciente_id in (select id from pacientes where user_id = auth.uid())
      );
    $q$;
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'historial_admin_all' and tablename = 'historial_clinico'
  ) then
    execute $q$
      create policy "historial_admin_all"
      on historial_clinico for all
      using (is_admin()) with check (is_admin());
    $q$;
  end if;
end$$;

-- Packs
do $$
begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'packs_select_own_or_admin' and tablename = 'paciente_packs'
  ) then
    execute $q$
      create policy "packs_select_own_or_admin"
      on paciente_packs for select
      using (
        is_admin() or
        paciente_id in (select id from pacientes where user_id = auth.uid())
      );
    $q$;
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'packs_admin_all' and tablename = 'paciente_packs'
  ) then
    execute $q$
      create policy "packs_admin_all"
      on paciente_packs for all
      using (is_admin()) with check (is_admin());
    $q$;
  end if;
end$$;

-- Caja movimientos (admin full, paciente solo lectura de los suyos si se usa paciente_id)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'caja_select_admin' and tablename = 'caja_movimientos'
  ) then
    execute $q$
      create policy "caja_select_admin"
      on caja_movimientos for select
      using (is_admin());
    $q$;
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'caja_select_own' and tablename = 'caja_movimientos'
  ) then
    execute $q$
      create policy "caja_select_own"
      on caja_movimientos for select
      using (
        paciente_id in (select id from pacientes where user_id = auth.uid())
      );
    $q$;
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'caja_admin_all' and tablename = 'caja_movimientos'
  ) then
    execute $q$
      create policy "caja_admin_all"
      on caja_movimientos for all
      using (is_admin()) with check (is_admin());
    $q$;
  end if;
end$$;

-- Inventario y recetas
do $$
begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'inventario_select_admin' and tablename = 'inventario'
  ) then
    execute $q$
      create policy "inventario_select_admin"
      on inventario for select
      using (is_admin());
    $q$;
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'inventario_admin_all' and tablename = 'inventario'
  ) then
    execute $q$
      create policy "inventario_admin_all"
      on inventario for all
      using (is_admin()) with check (is_admin());
    $q$;
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'recetas_select_admin' and tablename = 'recetas_tratamiento'
  ) then
    execute $q$
      create policy "recetas_select_admin"
      on recetas_tratamiento for select
      using (is_admin());
    $q$;
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'recetas_admin_all' and tablename = 'recetas_tratamiento'
  ) then
    execute $q$
      create policy "recetas_admin_all"
      on recetas_tratamiento for all
      using (is_admin()) with check (is_admin());
    $q$;
  end if;
end$$;

-- Comisiones
do $$
begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'comisiones_select_admin' and tablename = 'comisiones_pendientes'
  ) then
    execute $q$
      create policy "comisiones_select_admin"
      on comisiones_pendientes for select
      using (is_admin());
    $q$;
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'comisiones_admin_all' and tablename = 'comisiones_pendientes'
  ) then
    execute $q$
      create policy "comisiones_admin_all"
      on comisiones_pendientes for all
      using (is_admin()) with check (is_admin());
    $q$;
  end if;
end$$;
