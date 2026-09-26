// ============================================
// Tienda Virtual — admin.js (panel de administrador)
// ============================================
const API = '';
const TOKEN_KEY = 'tv_admin_token';

const state = {
  token: localStorage.getItem(TOKEN_KEY) || null,
  status: 'cotizando',
};

function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return [...root.querySelectorAll(sel)]; }

function money(n) {
  return '$' + Number(n ?? 0).toFixed(2);
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 3200);
}

function setError(formId, msg) {
  const el = document.querySelector(`[data-error-for="${formId}"]`);
  if (el) el.textContent = msg || '';
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const res = await fetch(API + path, { ...options, headers });
  let data = null;
  try { data = await res.json(); } catch (_) { /* sin body */ }

  if (!res.ok) {
    const msg = (data && data.error) || `Error ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// ---------- auth ----------
function setToken(token) {
  state.token = token;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

function showView(name) {
  ['auth', 'dashboard'].forEach(v => { $(`#view-${v}`).hidden = v !== name; });
}

function logout() {
  setToken(null);
  $('#appNav').hidden = true;
  showView('auth');
}
$('#logoutBtn').addEventListener('click', logout);

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  setError('loginForm', '');
  const fd = new FormData(e.target);
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const data = await api('/api/users/login', {
      method: 'POST',
      body: JSON.stringify({ phone: fd.get('phone'), password: fd.get('password') })
    });
    if (data.role !== 'admin') {
      setError('loginForm', 'Esta cuenta no tiene permisos de administrador.');
      return;
    }
    setToken(data.token);
    onLoggedIn(data.name);
  } catch (err) {
    setError('loginForm', err.message);
  } finally {
    btn.disabled = false;
  }
});

function onLoggedIn(name) {
  $('#appNav').hidden = false;
  $('#adminNameLabel').textContent = name ? `Hola, ${name}` : '';
  showView('dashboard');
  loadQuotes();
}

// ---------- dashboard ----------
$('#refreshBtn').addEventListener('click', loadQuotes);

$all('.admin-tabs .source-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $all('.admin-tabs .source-btn').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    state.status = btn.dataset.status;
    const titulos = { cotizando: 'Cotizaciones pendientes', pagado: 'Pedidos pagados, por completar', completado: 'Pedidos completados' };
    $('#dashboardTitle').textContent = titulos[state.status] || '';
    loadQuotes();
  });
});

async function loadQuotes() {
  const list = $('#quotesList');
  const empty = $('#quotesEmpty');

  let carritos;
  try {
    carritos = await api(`/api/admin/carritos?status=${state.status}`);
  } catch (err) {
    if (err.message.toLowerCase().includes('permisos') || err.message.toLowerCase().includes('token')) {
      toast('Tu sesión ya no es válida. Vuelve a entrar.');
      logout();
      return;
    }
    toast(err.message);
    return;
  }

  if (!carritos.length) {
    empty.hidden = false;
    list.hidden = true;
    list.innerHTML = '';
    return;
  }
  empty.hidden = true;
  list.hidden = false;
  list.innerHTML = carritos.map(renderQuoteCard).join('');

  $all('.quote-assign-form', list).forEach(form => {
    form.addEventListener('submit', onAssignSubmit);
  });
  $all('.quote-complete-btn', list).forEach(btn => {
    btn.addEventListener('click', onCompleteClick);
  });
}

function renderQuoteCard(carrito) {
  const subtotal = carrito.items.reduce((acc, i) => acc + i.precioFinalCliente, 0);
  const tienda = (carrito.items[0]?.source || '').toUpperCase();
  const fecha = new Date(carrito.updatedAt).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  const productosHtml = carrito.items.map(i => `
    <div class="order-product">
      <img src="${i.image || ''}" alt="" loading="lazy">
      <span class="order-product-title">${escapeHtml(i.title)}</span>
      <span class="order-product-price">${money(i.precioFinalCliente)}</span>
    </div>
  `).join('');

  let accionHtml = '';
  if (carrito.status === 'cotizando') {
    accionHtml = `
      <form class="quote-assign-form">
        <input type="number" name="costoEnvio" step="0.01" min="0" placeholder="Costo de envío" required>
        <button type="submit" class="btn btn-stamp btn-sm">Asignar y marcar pagado</button>
      </form>
    `;
  } else if (carrito.status === 'pagado') {
    accionHtml = `
      <div class="quote-assign-form">
        <span class="manifest-item-price">Envío: ${money(carrito.costoEnvio)} · Total: ${money(subtotal + (carrito.costoEnvio || 0))}</span>
        <button type="button" class="btn btn-stamp btn-sm quote-complete-btn">Marcar como completado</button>
      </div>
    `;
  } else {
    accionHtml = `
      <div class="quote-assign-form">
        <span class="manifest-item-price">Envío: ${money(carrito.costoEnvio)} · Total: ${money(subtotal + (carrito.costoEnvio || 0))} · Entregado ✅</span>
      </div>
    `;
  }

  return `
    <div class="quote-card" data-cart-id="${carrito._id}">
      <div class="order-head">
        <span class="order-id">#${String(carrito._id).slice(-6)} · ${fecha}</span>
        <span class="order-status is-${carrito.status}">${escapeHtml(tienda)}</span>
      </div>
      <p class="quote-customer">${escapeHtml(carrito.user?.name || 'Cliente')} · ${escapeHtml(carrito.user?.phone || 'sin teléfono')}</p>
      <div class="order-products">${productosHtml}</div>
      <div class="order-head" style="margin-bottom:0">
        <span>Subtotal</span>
        <span class="order-total">${money(subtotal)}</span>
      </div>
      ${accionHtml}
      <p class="form-error" data-error-for="quote-${carrito._id}"></p>
    </div>
  `;
}

async function onAssignSubmit(e) {
  e.preventDefault();
  const card = e.target.closest('.quote-card');
  const cartId = card.dataset.cartId;
  const fd = new FormData(e.target);
  const costoEnvio = fd.get('costoEnvio');
  const errId = `quote-${cartId}`;
  setError(errId, '');
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const data = await api(`/api/admin/carritos/${cartId}/envio`, {
      method: 'PUT',
      body: JSON.stringify({ costoEnvio: Number(costoEnvio) })
    });
    toast(data.mensaje || 'Envío asignado');
    loadQuotes();
  } catch (err) {
    setError(errId, err.message);
    btn.disabled = false;
  }
}

async function onCompleteClick(e) {
  const card = e.target.closest('.quote-card');
  const cartId = card.dataset.cartId;
  const errId = `quote-${cartId}`;
  setError(errId, '');
  e.target.disabled = true;
  try {
    const data = await api(`/api/admin/carritos/${cartId}/completar`, { method: 'PUT' });
    toast(data.mensaje || 'Pedido completado');
    loadQuotes();
  } catch (err) {
    setError(errId, err.message);
    e.target.disabled = false;
  }
}

// ---------- boot ----------
(function boot() {
  if (state.token) {
    onLoggedIn('');
  } else {
    showView('auth');
  }
})();
