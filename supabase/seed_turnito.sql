-- Seed de agendas Turnito (tratamientos + profesionales)

-- Profesionales (ejemplo con claves de Turnito si aplica)
insert into profesionales (id, nombre, especialidad, turnito_professional_key)
values
  ('00000000-0000-0000-0000-000000000001', 'Ofelia', 'Depilación / Corporal', 'ofelia'),
  ('00000000-0000-0000-0000-000000000002', 'Magali', 'Depilación / Corporal', 'magali'),
  ('00000000-0000-0000-0000-000000000003', 'Camila', 'Depilación / Facial', 'camila'),
  ('00000000-0000-0000-0000-000000000004', 'Dra. Eugenia', 'Médica', 'eugenia')
on conflict (id) do nothing;

-- Tratamientos con agenda Turnito
insert into tratamientos_catalogo (id, nombre, descripcion, categoria, precio, requires_eval, min_interval_days, turnito_url, turnito_eval_url, activo)
values
  ('vectus', 'Depilación Láser Vectus', 'Tecnología Vectus para depilación definitiva.', 'depilacion', 0, false, 30, 'https://turnito.app/c/depilacionvectus', null, true),
  ('soprano', 'Depilación Láser Soprano', 'Tecnología Soprano con barrido indoloro.', 'depilacion', 0, false, 30, 'https://turnito.app/c/depilacionsoprano', null, true),
  ('ultherapy', 'Ultherapy', 'Lifting sin cirugía con ultrasonido focalizado.', 'medica', 0, true, 180, null, 'https://turnito.app/c/facialesultherapy', true),
  ('prp', 'Plasma Rico en Plaquetas', 'Regeneración celular con PRP.', 'medica', 0, true, 30, null, 'https://turnito.app/c/plasma', true),
  ('meso_facial', 'Mesoterapia Facial', 'Activos revitalizantes para rostro.', 'facial', 0, false, 7, 'https://turnito.app/c/mesoterapia', null, true),
  ('meso_corp', 'Mesoterapia Corporal', 'Activos para celulitis y modelado.', 'corporal', 0, false, 7, 'https://turnito.app/c/mesocorporales', null, true),
  ('botox', 'Botox', 'Toxina botulínica para líneas de expresión.', 'facial', 0, true, 120, null, 'https://turnito.app/c/facialesbotox', true),
  ('powershape', 'PowerShape', 'Programa de modelado corporal.', 'corporal', 0, false, 7, 'https://turnito.app/c/powershape', null, true)
on conflict (id) do nothing;
