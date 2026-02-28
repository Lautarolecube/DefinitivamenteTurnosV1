/**
 * Elite Booking — Frontend SPA
 * HTML5 + Tailwind CDN + Vanilla JS (ES6+)
 */

const CONFIG = {
  SUPABASE_URL: 'https://aeumhaddvjltwxunzque.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFldW1oYWRkdmpsdHd4dW56cXVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4NTQyMTgsImV4cCI6MjA4NjQzMDIxOH0.hHsmPoAp21gR3UCVM4EmwzftrFcMUmqaKsEl0PgfhLU', 
};

const FUNCTIONS_URL = `${CONFIG.SUPABASE_URL}/functions/v1`;

const CATEGORY_COLORS = [
  { bg: '#FFADAD', name: 'pastel-rose' },
  { bg: '#FFD6A5', name: 'pastel-peach' },
  { bg: '#CAFFBF', name: 'pastel-mint' },
  { bg: '#9BF6FF', name: 'pastel-sky' },
  { bg: '#A0C4FF', name: 'pastel-lavender' },
  { bg: '#BDB2FF', name: 'pastel-violet' },
  { bg: '#FFC6FF', name: 'pastel-pink' },
];

const CATEGORY_ICONS = ['✨', '💆', '💉', '🧴', '🌟', '💫', '🌸'];

const state = {
  step: 1,
  categories: [],
  services: [],
  professionals: [],
  selectedCategory: null,
  selectedService: null,
  selectedProfessional: null,
  selectedDate: '',
  selectedSlot: null,
};

// === CAMBIO CRÍTICO: supabase -> supabaseClient ===
let supabaseClient = null;
if (typeof window !== 'undefined' && window.supabase) {
  try {
    const { createClient } = window.supabase;
    supabaseClient = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY || '');
  } catch (e) {
    console.warn('Supabase client no inicializado:', e);
  }
}

function getFunctionsUrl(path) {
  return `${FUNCTIONS_URL}${path}`;
}

function getTodayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function goToStep(step) {
  state.step = step;
  document.querySelectorAll('.elite-step').forEach((el) => el.classList.remove('active'));
  const section = document.getElementById(`step-${step}`);
  if (section) section.classList.add('active');
  document.querySelectorAll('.elite-step-dot').forEach((dot) => {
    dot.classList.toggle('active', parseInt(dot.dataset.step, 10) === step);
  });
  if (step === 1) document.getElementById('logo').setAttribute('href', '#');
}

async function loadCategories() {
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient.from('categorias_servicios').select('id, nombre').order('nombre');
      if (!error && data && data.length > 0) {
        state.categories = data.map((c) => ({ id: c.id, nombre: c.nombre || c.id }));
        return;
      }
    } catch (e) {
      console.warn('categorias_servicios no disponible, usando categorías por defecto', e);
    }
  }
  // Fallback si falla la DB
  state.categories = [
    { id: 'vectus', nombre: 'Vectus' },
    { id: 'soprano', nombre: 'Soprano' },
    { id: 'botox_rellenos', nombre: 'Botox' }
  ];
}

function renderStep1() {
  const grid = document.getElementById('categories-grid');
  if (!grid) return;
  grid.innerHTML = state.categories
    .map((cat, i) => {
      const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
      const icon = CATEGORY_ICONS[i % CATEGORY_ICONS.length];
      return `
        <button type="button" class="elite-card bg-white border-2 border-pastel-peach hover:border-pastel-rose" data-category-id="${escapeHtml(cat.id)}" data-category-name="${escapeHtml(cat.nombre)}">
          <div class="elite-card-icon" style="background-color: ${color.bg}">${icon}</div>
          <span class="font-semibold text-pastel-ink">${escapeHtml(cat.nombre)}</span>
        </button>
      `;
    })
    .join('');
  grid.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedCategory = { id: btn.dataset.categoryId, nombre: btn.dataset.categoryName };
      loadServicesForCategory(state.selectedCategory.id).then(() => {
        renderStep2();
        goToStep(2);
      });
    });
  });
}

async function loadServicesForCategory(categoryId) {
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('servicios_items')
        .select('id, nombre_zona, precio_total, monto_sena, categoria_id');
      if (!error && data && data.length > 0) {
        const filtered = categoryId
          ? data.filter((s) => s.categoria_id === categoryId)
          : data;
        state.services = filtered.length > 0 ? filtered : data;
        return;
      }
    } catch (e) {
      console.warn('servicios_items no disponible', e);
    }
  }
  state.services = [];
}

function renderStep2() {
  const list = document.getElementById('services-list');
  const subtitle = document.getElementById('step2-subtitle');
  if (!list) return;
  if (state.selectedCategory) subtitle.textContent = `Tratamientos en ${state.selectedCategory.nombre}.`;
  
  if (state.services.length === 0) {
      list.innerHTML = `<p class="text-pastel-muted">No hay tratamientos disponibles en esta categoría.</p>`;
      return;
  }

  list.innerHTML = state.services
    .map(
      (s) => `
      <div class="elite-service-card bg-white p-4 rounded-lg shadow-sm border border-gray-100 flex justify-between items-center mb-3">
        <div class="flex-1 min-w-0">
          <div class="elite-service-name font-semibold text-lg text-pastel-ink">${escapeHtml(s.nombre_zona || s.nombre || s.id)}</div>
          <div class="elite-service-price text-gray-500 text-sm">Precio total: $${formatPrice(s.precio_total)}</div>
        </div>
        <div class="flex flex-col items-end gap-2 flex-wrap">
          <span class="elite-service-sena text-pastel-rose font-bold">Seña: $${formatPrice(s.monto_sena)}</span>
          <button type="button" class="elite-service-btn reserve-btn bg-pastel-mint px-4 py-2 rounded-md font-medium text-pastel-ink hover:bg-opacity-80" data-service-id="${escapeHtml(s.id)}" data-service-name="${escapeHtml(s.nombre_zona || s.nombre || '')}" data-monto-sena="${escapeHtml(String(s.monto_sena))}">Reservar</button>
        </div>
      </div>
    `
    )
    .join('');
    
  list.querySelectorAll('.reserve-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedService = {
        id: btn.dataset.serviceId,
        nombre: btn.dataset.serviceName,
        monto_sena: btn.dataset.montoSena,
      };
      loadProfessionals().then(() => {
        setDateMin();
        renderStep3();
        goToStep(3);
        loadSlots();
      });
    });
  });
}

async function loadProfessionals() {
  if (supabaseClient) {
    try {
      // Cargamos profesionales filtrados por la categoría seleccionada usando la tabla intermedia
      const { data, error } = await supabaseClient
        .from('profesional_categorias')
        .select(`
            profesional_id,
            profesionales (id, nombre)
        `)
        .eq('categoria_id', state.selectedCategory.id);
        
      if (!error && data && data.length > 0) {
        // Formatear la respuesta
        state.professionals = data.map(rel => ({
            id: rel.profesionales.id,
            nombre: rel.profesionales.nombre
        }));
        return;
      }
    } catch (e) {
      console.warn('profesionales no disponible', e);
    }
  }
  state.professionals = [];
}

function setDateMin() {
  const input = document.getElementById('date-input');
  if (input) input.min = getTodayISO();
}

function renderStep3() {
  const select = document.getElementById('professional-select');
  const dateInput = document.getElementById('date-input');
  if (!select) return;
  select.innerHTML =
    '<option value="">Seleccioná un profesional</option>' +
    state.professionals.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.nombre)}</option>`).join('');
  if (dateInput) dateInput.value = state.selectedDate || getTodayISO();

  select.addEventListener('change', () => {
    state.selectedProfessional = select.value ? state.professionals.find((p) => p.id === select.value) : null;
    state.selectedSlot = null;
    loadSlots();
  });
  dateInput.addEventListener('change', () => {
    state.selectedDate = dateInput.value;
    state.selectedSlot = null;
    loadSlots();
  });

  state.selectedProfessional = null;
  state.selectedDate = dateInput?.value || getTodayISO();
  document.getElementById('slots-loading').classList.add('hidden');
  document.getElementById('slots-empty').classList.remove('hidden');
  document.getElementById('slots-buttons').innerHTML = '';
  document.getElementById('btn-continue-step4')?.classList.add('hidden');
}

function onContinueToStep4() {
  renderStep4Summary();
  goToStep(4);
}

async function loadSlots() {
  const container = document.getElementById('slots-buttons');
  const loading = document.getElementById('slots-loading');
  const empty = document.getElementById('slots-empty');
  const profSelect = document.getElementById('professional-select');
  const dateInput = document.getElementById('date-input');
  if (!container || !state.selectedService) return;

  const professionalId = profSelect?.value;
  const date = dateInput?.value;
  if (!professionalId || !date) {
    loading.classList.add('hidden');
    empty.classList.remove('hidden');
    empty.textContent = 'Elegí profesional y fecha.';
    container.innerHTML = '';
    return;
  }

  loading.classList.remove('hidden');
  empty.classList.add('hidden');
  container.innerHTML = '';

  try {
    const res = await fetch(getFunctionsUrl('/get-availability'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        professional_id: professionalId,
        service_item_id: state.selectedService.id,
        date,
      }),
    });
    const data = await res.json().catch(() => ({}));
    loading.classList.add('hidden');
    if (!res.ok) {
      empty.classList.remove('hidden');
      empty.textContent = data.error || 'Error al cargar horarios.';
      return;
    }
    const slots = data.slots || [];
    if (slots.length === 0) {
      empty.classList.remove('hidden');
      empty.textContent = 'No hay horarios disponibles ese día.';
      return;
    }
    empty.classList.add('hidden');
    container.innerHTML = slots
      .map(
        (time) => `
        <button type="button" class="elite-slot px-4 py-2 border rounded-md hover:bg-pastel-peach ${state.selectedSlot === time ? 'bg-pastel-rose text-white border-pastel-rose' : 'bg-white border-gray-200'}" data-slot="${escapeHtml(time)}">${escapeHtml(time)}</button>
      `
      )
      .join('');
    container.querySelectorAll('.elite-slot').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.selectedSlot = btn.dataset.slot;
        // Reset styles
        container.querySelectorAll('.elite-slot').forEach((b) => {
            b.classList.remove('bg-pastel-rose', 'text-white', 'border-pastel-rose');
            b.classList.add('bg-white', 'border-gray-200');
        });
        // Apply selected style
        btn.classList.remove('bg-white', 'border-gray-200');
        btn.classList.add('bg-pastel-rose', 'text-white', 'border-pastel-rose');
        
        const continueBtn = document.getElementById('btn-continue-step4');
        if (continueBtn) continueBtn.classList.remove('hidden');
      });
    });
    const continueBtn = document.getElementById('btn-continue-step4');
    if (continueBtn) continueBtn.classList.add('hidden');
  } catch (err) {
    loading.classList.add('hidden');
    empty.classList.remove('hidden');
    empty.textContent = 'Error de conexión. Revisá la consola.';
    console.error(err);
  }
}

function renderStep4Summary() {
  const summary = document.getElementById('step4-summary');
  if (!summary) return;
  const prof = state.selectedProfessional?.nombre || '-';
  summary.innerHTML = `
    <div class="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
        <p class="mb-2"><strong class="text-pastel-ink">Tratamiento:</strong> ${escapeHtml(state.selectedService?.nombre || '')}</p>
        <p class="mb-2"><strong class="text-pastel-ink">Profesional:</strong> ${escapeHtml(prof)}</p>
        <p class="mb-2"><strong class="text-pastel-ink">Fecha:</strong> ${escapeHtml(state.selectedDate || '')} · <strong>Hora:</strong> ${escapeHtml(state.selectedSlot || '')}</p>
        <p class="mt-4 text-lg"><strong class="text-pastel-rose">Seña a pagar: $${formatPrice(state.selectedService?.monto_sena || 0)}</strong></p>
    </div>
  `;
}

function formatPrice(val) {
  const n = Number(val);
  if (Number.isNaN(n)) return '0';
  return new Intl.NumberFormat('es-AR').format(n);
}

function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function submitPayment(formData) {
  const professionalId = document.getElementById('professional-select')?.value;
  if (!professionalId || !state.selectedService || !state.selectedDate || !state.selectedSlot) {
    alert('Faltan datos de la reserva. Volvé al paso anterior.');
    return;
  }
  const btn = document.getElementById('btn-pay');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Redirigiendo a Mercado Pago...';
    btn.classList.add('opacity-50', 'cursor-not-allowed');
  }
  try {
    const res = await fetch(getFunctionsUrl('/create-preference'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        professional_id: professionalId,
        service_item_id: state.selectedService.id,
        date: state.selectedDate,
        time: state.selectedSlot,
        client_data: {
          nombre: formData.get('nombre'),
          apellido: formData.get('apellido'),
          email: formData.get('email'),
          telefono: formData.get('telefono'),
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.init_point) {
      window.location.href = data.init_point;
      return;
    }
    alert(data.error || 'No se pudo crear el link de pago. Intentá de nuevo.');
    console.error(data);
  } catch (err) {
    alert('Error de conexión.');
    console.error(err);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Ir a Pagar';
      btn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
  }
}

function init() {
  document.getElementById('back-from-2')?.addEventListener('click', () => goToStep(1));
  document.getElementById('back-from-3')?.addEventListener('click', () => goToStep(2));
  document.getElementById('back-from-4')?.addEventListener('click', () => goToStep(3));
  document.getElementById('btn-continue-step4')?.addEventListener('click', onContinueToStep4);

  document.getElementById('client-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    submitPayment(new FormData(form));
  });

  loadCategories().then(() => {
    renderStep1();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}