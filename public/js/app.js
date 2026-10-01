// ============================================
// Tienda Virtual — app.js (vanilla, sin build)
// ============================================
const API = '';
const TOKEN_KEY = 'tv_token';
const ROLE_KEY = 'tv_role';
const MAX_MODAL_PHOTOS = 5;

const state = {
  token: localStorage.getItem(TOKEN_KEY) || null,
  role: localStorage.getItem(ROLE_KEY) || null,
  source: 'amazon',
  adminStatus: 'cotizando',
  modalItem: null, // { originalId, source } del producto que esta abierto en el modal
  modalSize: null, // talla elegida en el modal (si el producto maneja tallas)
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

function setRole(role) {
  state.role = role || null;
  if (role) localStorage.setItem(ROLE_KEY, role);
  else localStorage.removeItem(ROLE_KEY);
}

function isLoggedIn() { return !!state.token; }
function isAdmin() { return state.role === 'admin'; }

function logout() {
  setToken(null);
  setRole(null);
  $('#appNav').hidden = true;
  showView('auth');
}

// ---------- views ----------
const VIEWS = ['auth', 'search', 'cart', 'orders', 'services', 'admin'];

function showView(name) {
  VIEWS.forEach(v => { $(`#view-${v}`).hidden = v !== name; });
  $all('.nav-link[data-view]').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.view === name);
  });
  if (name === 'cart') renderCart();
  if (name === 'orders') renderOrders();
  if (name === 'admin') renderAdmin();
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
    setRole(data.role || 'cliente');
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
    setRole('cliente');
    onLoggedIn();
  } catch (err) {
    setError('registerForm', err.message);
  }
});

function onLoggedIn() {
  $('#appNav').hidden = false;
  $('#adminNavLink').hidden = !isAdmin();
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
function renderModalGallery(fotos) {
  $('#modalGallery').innerHTML = fotos
    .map((src, i) => `<img src="${src}" alt="" loading="lazy" data-idx="${i}">`)
    .join('');

  $all('#modalGallery img').forEach(img => {
    img.addEventListener('click', () => {
      const idx = Number(img.dataset.idx);
      if (idx === 0) return; // la primera ya esta en grande
      const reordenadas = [...fotos];
      [reordenadas[0], reordenadas[idx]] = [reordenadas[idx], reordenadas[0]];
      renderModalGallery(reordenadas);
    });
  });
}

function renderModalSizes(sizes) {
  const el = $('#modalSizes');
  const addBtn = $('#modalAddBtn');
  state.modalSize = null;

  if (!sizes || sizes.length === 0) {
    el.hidden = true;
    el.innerHTML = '';
    addBtn.disabled = false;
    return;
  }

  el.hidden = false;
  el.innerHTML = sizes.map(s => `
    <button type="button" class="size-chip" data-size="${escapeHtml(s.size)}" ${s.inStock === false ? 'disabled' : ''}>${escapeHtml(s.size)}</button>
  `).join('');
  addBtn.disabled = true; // obliga a elegir talla antes de agregar

  $all('.size-chip', el).forEach(btn => {
    btn.addEventListener('click', () => {
      $all('.size-chip', el).forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      state.modalSize = btn.dataset.size;
      addBtn.disabled = false;
    });
  });
}

async function openProductModal(item) {
  state.modalItem = { originalId: item.originalId, source: item.source };
  state.modalSize = null;

  $('#productModal').hidden = false;
  $('#modalLoading').hidden = false;
  $('#modalBody').hidden = true;
  $('#modalError').textContent = '';
  document.body.style.overflow = 'hidden';

  try {
    // Mismo endpoint que usa "agregar al carrito": trae el detalle completo
    // (incluye TODAS las fotos y las tallas si aplica) y ya deja el producto
    // cacheado con precio actualizado.
    const data = await api('/api/search', {
      method: 'POST',
      body: JSON.stringify(state.modalItem)
    });
    const p = data.data;
    const fotos = (p.images || []).slice(0, MAX_MODAL_PHOTOS);

    renderModalGallery(fotos.length ? fotos : [item.image || '']);
    renderModalSizes(p.sizes);
    $('#modalSource').textContent = p.source.toUpperCase();
    $('#modalTitle').textContent = p.title;
    $('#modalPrice').textContent = money(p.precioFinalCliente);

    $('#modalLoading').hidden = true;
    $('#modalBody').hidden = false;
  } catch (err) {
    $('#modalLoading').hidden = true;
    $('#modalBody').hidden = false;
    $('#modalGallery').innerHTML = '';
    $('#modalSizes').hidden = true;
    $('#modalError').textContent = err.message;
  }
}

function closeProductModal() {
  $('#productModal').hidden = true;
  document.body.style.overflow = '';
  state.modalItem = null;
  state.modalSize = null;
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
  if (!$('#modalSizes').hidden && !state.modalSize) {
    $('#modalError').textContent = 'Elige una talla antes de continuar.';
    return;
  }
  const btn = $('#modalAddBtn');
  $('#modalError').textContent = '';
  btn.disabled = true;
  btn.textContent = 'Agregando…';
  try {
    // El producto ya quedo cacheado al abrir el modal (llamada a /api/search arriba)
    await api('/api/carrito', {
      method: 'POST',
      body: JSON.stringify({ ...state.modalItem, size: state.modalSize || undefined })
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
        <span class="manifest-item-price">${money(item.precioFinalCliente)} · ${item.source.toUpperCase()}${item.size ? ' · Talla ' + escapeHtml(item.size) : ''}</span>
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
        <span class="order-product-title">${escapeHtml(p.titulo)}${p.talla ? ' · Talla ' + escapeHtml(p.talla) : ''}</span>
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

// ---------- admin ----------
$all('.status-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    $all('.status-tab').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    state.adminStatus = btn.dataset.adminStatus;
    renderAdmin();
  });
});

async function renderAdmin() {
  const empty = $('#adminEmpty');
  const list = $('#adminList');
  list.innerHTML = '';
  empty.hidden = true;

  let carritos;
  try {
    carritos = await api(`/api/admin/carritos?status=${state.adminStatus}`);
  } catch (err) {
    toast(err.message);
    return;
  }

  if (!carritos.length) {
    empty.hidden = false;
    return;
  }

  list.innerHTML = carritos.map(c => {
    const subtotal = c.items.reduce((s, it) => s + it.precioFinalCliente, 0);
    const statusClass = `is-${c.status}`;
    const cliente = c.user ? `${escapeHtml(c.user.name)} - ${escapeHtml(c.user.phone)}` : 'Cliente';

    const productosHtml = c.items.map(it => `
      <div class="order-product">
        <img src="${it.image || ''}" alt="" loading="lazy">
        <span class="order-product-title">${escapeHtml(it.title)}${it.size ? ' · Talla ' + escapeHtml(it.size) : ''}</span>
        <span class="order-product-price">${money(it.precioFinalCliente)}</span>
      </div>
    `).join('');

    let footerHtml = '';
    if (c.status === 'cotizando') {
      footerHtml = `
        <div class="envio-row">
          <input type="number" min="0" step="0.01" class="envio-input" placeholder="Costo de envio" data-envio-input="${c._id}">
          <button class="btn btn-primary btn-sm" data-action="asignar" data-id="${c._id}">Asignar y marcar pagado</button>
        </div>
        <p class="form-error" data-envio-error="${c._id}"></p>
      `;
    } else if (c.status === 'pagado') {
      footerHtml = `
        <p class="manifest-item-price">Envio: ${money(c.costoEnvio)} - Total: ${money(subtotal + c.costoEnvio)}</p>
        <button class="btn btn-primary btn-sm" data-action="completar" data-id="${c._id}">Marcar completado</button>
      `;
    } else {
      footerHtml = `<p class="manifest-item-price">Envio: ${money(c.costoEnvio)} - Total: ${money(subtotal + c.costoEnvio)}</p>`;
    }

    return `
      <div class="order-card">
        <div class="order-head">
          <span class="order-id">${cliente}</span>
          <span class="order-status ${statusClass}">${c.status}</span>
        </div>
        <div class="order-products">${productosHtml}</div>
        <div class="order-head" style="margin-bottom:0">
          <span>Subtotal</span>
          <span class="order-total">${money(subtotal)}</span>
        </div>
        ${footerHtml}
      </div>
    `;
  }).join('');

  $all('[data-action="asignar"]', list).forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const input = $(`[data-envio-input="${id}"]`, list);
      const errEl = $(`[data-envio-error="${id}"]`, list);
      const costoEnvio = Number(input.value);
      errEl.textContent = '';
      if (!input.value || costoEnvio < 0) {
        errEl.textContent = 'Indica un costo de envio valido';
        return;
      }
      btn.disabled = true;
      try {
        await api(`/api/admin/carritos/${id}/envio`, {
          method: 'PUT',
          body: JSON.stringify({ costoEnvio })
        });
        toast('Envio asignado, carrito marcado como pagado');
        renderAdmin();
      } catch (err) {
        errEl.textContent = err.message;
        btn.disabled = false;
      }
    });
  });

  $all('[data-action="completar"]', list).forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      btn.disabled = true;
      try {
        await api(`/api/admin/carritos/${id}/completar`, { method: 'PUT' });
        toast('Pedido marcado como completado');
        renderAdmin();
      } catch (err) {
        toast(err.message);
        btn.disabled = false;
      }
    });
  });
}
// ---------- boot ----------
(function boot() {
  if (isLoggedIn()) {
    onLoggedIn();
  } else {
    showView('auth');
  }
})();
