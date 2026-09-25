// ============================================
// Tienda Virtual — app.js (vanilla, sin build)
// ============================================
const API = '';
const TOKEN_KEY = 'tv_token';
const MAX_MODAL_PHOTOS = 5;

const state = {
  token: localStorage.getItem(TOKEN_KEY) || null,
  source: 'amazon',
  modalItem: null, // { originalId, source } del producto que esta abierto en el modal
};

// ---------- helpers ----------
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
  const el = document.querySelector(`[data-error-for="${formId}"]`) || $(`#${formId}`);
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

function isLoggedIn() { return !!state.token; }

function logout() {
  setToken(null);
  $('#appNav').hidden = true;
  showView('auth');
}

// ---------- views ----------
const VIEWS = ['auth', 'search', 'cart', 'orders'];

function showView(name) {
  VIEWS.forEach(v => { $(`#view-${v}`).hidden = v !== name; });
  $all('.nav-link[data-view]').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.view === name);
  });
  if (name === 'cart') renderCart();
  if (name === 'orders') renderOrders();
}

$all('[data-view]').forEach(btn => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

$('#logoutBtn').addEventListener('click', logout);

// ---------- auth tabs ----------
$all('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $all('.auth-tab').forEach(t => t.classList.remove('is-active'));
    tab.classList.add('is-active');
    const isLogin = tab.dataset.tab === 'login';
    $('#loginForm').hidden = !isLogin;
    $('#registerForm').hidden = isLogin;
  });
});

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  setError('loginForm', '');
  const fd = new FormData(e.target);
  try {
    const data = await api('/api/users/login', {
      method: 'POST',
      body: JSON.stringify({ phone: fd.get('phone'), password: fd.get('password') })
    });
    setToken(data.token);
    onLoggedIn();
  } catch (err) {
    setError('loginForm', err.message);
  }
});

$('#registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  setError('registerForm', '');
  const fd = new FormData(e.target);
  try {
    const data = await api('/api/users/register', {
      method: 'POST',
      body: JSON.stringify({ name: fd.get('name'), phone: fd.get('phone'), password: fd.get('password') })
    });
    setToken(data.token);
    onLoggedIn();
  } catch (err) {
    setError('registerForm', err.message);
  }
});

function onLoggedIn() {
  $('#appNav').hidden = false;
  showView('search');
  refreshCartCount();
}

// ---------- search (por palabra clave) ----------
$all('.source-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $all('.source-btn').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    state.source = btn.dataset.source;
    $('#searchResults').hidden = true;
    $('#resultsCount').hidden = true;
  });
});

$('#searchForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  setError('searchForm', '');
  const query = $('#searchInput').value.trim();
  if (!query) return;

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Buscando…';
  $('#searchResults').hidden = true;
  $('#resultsCount').hidden = true;

  try {
    const data = await api('/api/search/query', {
      method: 'POST',
      body: JSON.stringify({ query, source: state.source })
    });
    renderSearchResults(data.resultados || []);
  } catch (err) {
    setError('searchForm', err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Buscar';
  }
});

function renderSearchResults(resultados) {
  const grid = $('#searchResults');
  const count = $('#resultsCount');
  grid.innerHTML = '';

  if (resultados.length === 0) {
    count.hidden = false;
    count.textContent = 'No encontramos productos para esa búsqueda. Prueba con otras palabras.';
    grid.hidden = true;
    return;
  }

  count.hidden = false;
  count.textContent = `${resultados.length} resultados — toca uno para ver más fotos`;

  resultados.forEach(item => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'result-item';
    card.innerHTML = `
      <img src="${item.image || ''}" alt="" loading="lazy">
      <div class="result-item-body">
        <p class="result-item-title">${escapeHtml(item.title)}</p>
        <span class="result-item-price">${money(item.precioFinalCliente)}</span>
      </div>
    `;
    card.addEventListener('click', () => openProductModal(item));
    grid.appendChild(card);
  });

  grid.hidden = false;
}

// ---------- product modal (galeria de hasta 5 fotos) ----------
async function openProductModal(item) {
  state.modalItem = { originalId: item.originalId, source: item.source };

  $('#productModal').hidden = false;
  $('#modalLoading').hidden = false;
  $('#modalBody').hidden = true;
  $('#modalError').textContent = '';
  document.body.style.overflow = 'hidden';

  try {
    // Mismo endpoint que usa "agregar al carrito": trae el detalle completo
    // (incluye TODAS las fotos) y ya deja el producto cacheado con precio actualizado.
    const data = await api('/api/search', {
      method: 'POST',
      body: JSON.stringify(state.modalItem)
    });
    const p = data.data;
    const fotos = (p.images || []).slice(0, MAX_MODAL_PHOTOS);

    $('#modalGallery').innerHTML = (fotos.length ? fotos : [item.image || ''])
      .map(src => `<img src="${src}" alt="" loading="lazy">`)
      .join('');
    $('#modalSource').textContent = p.source.toUpperCase();
    $('#modalTitle').textContent = p.title;
    $('#modalPrice').textContent = money(p.precioFinalCliente);

    $('#modalLoading').hidden = true;
    $('#modalBody').hidden = false;
  } catch (err) {
    $('#modalLoading').hidden = true;
    $('#modalBody').hidden = false;
    $('#modalGallery').innerHTML = '';
    $('#modalError').textContent = err.message;
  }
}

function closeProductModal() {
  $('#productModal').hidden = true;
  document.body.style.overflow = '';
  state.modalItem = null;
}

$('#modalCloseBtn').addEventListener('click', closeProductModal);
$('#productModal').addEventListener('click', (e) => {
  if (e.target.id === 'productModal') closeProductModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#productModal').hidden) closeProductModal();
});

$('#modalAddBtn').addEventListener('click', async () => {
  if (!state.modalItem) return;
  const btn = $('#modalAddBtn');
  $('#modalError').textContent = '';
  btn.disabled = true;
  btn.textContent = 'Agregando…';
  try {
    // El producto ya quedo cacheado al abrir el modal (llamada a /api/search arriba)
    await api('/api/carrito', {
      method: 'POST',
      body: JSON.stringify(state.modalItem)
    });
    toast('Agregado al carrito');
    refreshCartCount();
    closeProductModal();
  } catch (err) {
    $('#modalError').textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Agregar al carrito';
  }
});

// ---------- cart ----------
async function refreshCartCount() {
  try {
    const carrito = await api('/api/carrito');
    const count = (carrito.items || []).length;
    $('#cartCount').textContent = count;
  } catch (_) { /* silencioso */ }
}

async function renderCart() {
  const list = $('#cartList');
  const empty = $('#cartEmpty');
  const footer = $('#cartFooter');
  list.innerHTML = '';

  let carrito;
  try {
    carrito = await api('/api/carrito');
  } catch (err) {
    toast(err.message);
    return;
  }

  const items = carrito.items || [];
  if (items.length === 0) {
    empty.hidden = false;
    footer.hidden = true;
    return;
  }
  empty.hidden = true;
  footer.hidden = false;

  let subtotal = 0;
  items.forEach(item => {
    subtotal += item.precioFinalCliente;
    const li = document.createElement('li');
    li.className = 'manifest-item';
    li.innerHTML = `
      <img src="${item.image || ''}" alt="">
      <div>
        <p class="manifest-item-title">${escapeHtml(item.title)}</p>
        <span class="manifest-item-price">${money(item.precioFinalCliente)} · ${item.source.toUpperCase()}</span>
      </div>
      <button class="manifest-item-remove" data-item-id="${item._id}">Quitar</button>
    `;
    list.appendChild(li);
  });

  $('#cartSubtotal').textContent = money(subtotal);

  $all('.manifest-item-remove', list).forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/carrito/${btn.dataset.itemId}`, { method: 'DELETE' });
        renderCart();
        refreshCartCount();
      } catch (err) {
        toast(err.message);
      }
    });
  });
}

$('#confirmCartBtn').addEventListener('click', async () => {
  $('#confirmCartError').textContent = '';
  const btn = $('#confirmCartBtn');
  btn.disabled = true;
  try {
    const data = await api('/api/carrito/confirmar', { method: 'PUT' });
    toast(data.mensaje || 'Cotización confirmada');
    refreshCartCount();
    showView('orders');
  } catch (err) {
    $('#confirmCartError').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

// ---------- orders (historial completo de cotizaciones) ----------
async function renderOrders() {
  const empty = $('#ordersEmpty');
  const content = $('#ordersContent');
  content.innerHTML = '';

  let data;
  try {
    data = await api('/api/carrito/historial');
  } catch (err) {
    empty.hidden = false;
    empty.querySelector('p').textContent = err.message;
    return;
  }

  const historial = data.historial || [];
  if (historial.length === 0) {
    empty.hidden = false;
    empty.querySelector('p').textContent = 'Todavía no tienes cotizaciones confirmadas.';
    return;
  }
  empty.hidden = true;

  content.innerHTML = historial.map(t => {
    const statusClass = t.estado === 'cotizando' ? 'is-cotizando' : 'is-pagado';
    const statusLabel = t.estado === 'cotizando' ? 'Cotizando envío' : (t.estado === 'completado' ? 'Completado' : 'Envío asignado');
    const fecha = new Date(t.fecha).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });

    const productosHtml = t.productos.map(p => `
      <div class="order-product">
        <img src="${p.imagen || ''}" alt="" loading="lazy">
        <span class="order-product-title">${escapeHtml(p.titulo)}</span>
        <span class="order-product-price">${money(p.precio)}</span>
      </div>
    `).join('');

    return `
      <div class="order-card">
        <div class="order-head">
          <span class="order-id">#${String(t.numeroOrden).slice(-6)} · ${fecha}</span>
          <span class="order-status ${statusClass}">${statusLabel}</span>
        </div>
        <div class="order-products">${productosHtml}</div>
        <div class="order-head" style="margin-bottom:0">
          <span>Tienda: ${t.tiendaOrigen}</span>
          <span class="order-total">${money(t.desglose.totalPagar)}</span>
        </div>
        ${t.estado !== 'cotizando' ? `<p class="manifest-item-price" style="margin-top:8px">Subtotal ${money(t.desglose.subtotal)} + envío ${money(t.desglose.envio)}</p>` : ''}
      </div>
    `;
  }).join('');
}

// ---------- boot ----------
(function boot() {
  if (isLoggedIn()) {
    onLoggedIn();
  } else {
    showView('auth');
  }
})();
