// ============================================
// Tienda Virtual — app.js (vanilla, sin build)
// ============================================
const API = '';
const TOKEN_KEY = 'tv_token';

const state = {
  token: localStorage.getItem(TOKEN_KEY) || null,
  source: 'amazon',
  lastResult: null, // último producto buscado (para agregar al carrito)
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
      body: JSON.stringify({ email: fd.get('email'), password: fd.get('password') })
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
      body: JSON.stringify({ name: fd.get('name'), email: fd.get('email'), password: fd.get('password') })
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

// ---------- search ----------
$all('.source-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $all('.source-btn').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    state.source = btn.dataset.source;
    $('#searchInput').placeholder = state.source === 'amazon'
      ? 'B0BSHF7WHW'
      : 'https://us.shein.com/producto-p-12345.html';
    $('#searchResult').hidden = true;
    state.lastResult = null;
  });
});

$('#searchForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  setError('searchForm', '');
  $('#searchResult').hidden = true;
  const originalId = $('#searchInput').value.trim();
  if (!originalId) return;

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Consultando…';

  try {
    const data = await api('/api/search', {
      method: 'POST',
      body: JSON.stringify({ originalId, source: state.source })
    });
    const p = data.data;
    state.lastResult = { originalId: p.originalId, source: p.source };

    $('#resultImg').src = (p.images && p.images[0]) || '';
    $('#resultSource').textContent = p.source.toUpperCase();
    $('#resultTitle').textContent = p.title;
    $('#resultPriceOrigin').textContent = money(p.price);
    $('#resultPriceFinal').textContent = money(p.precioFinalCliente);
    $('#addToCartError').textContent = '';
    $('#searchResult').hidden = false;
  } catch (err) {
    setError('searchForm', err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Cotizar producto';
  }
});

$('#addToCartBtn').addEventListener('click', async () => {
  if (!state.lastResult) return;
  $('#addToCartError').textContent = '';
  try {
    await api('/api/carrito', {
      method: 'POST',
      body: JSON.stringify(state.lastResult)
    });
    toast('Agregado al carrito');
    refreshCartCount();
  } catch (err) {
    $('#addToCartError').textContent = err.message;
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

// ---------- orders (ticket de la cotización en curso) ----------
async function renderOrders() {
  const empty = $('#ordersEmpty');
  const content = $('#ordersContent');
  content.innerHTML = '';

  let data;
  try {
    data = await api('/api/carrito/ticket');
  } catch (err) {
    empty.hidden = false;
    empty.querySelector('p').textContent = err.message.includes('No tienes')
      ? 'Todavía no tienes cotizaciones confirmadas.'
      : err.message;
    return;
  }
  empty.hidden = true;

  const t = data.ticket;
  const statusClass = t.estado === 'pagado' ? 'is-pagado' : 'is-cotizando';
  const statusLabel = t.estado === 'pagado' ? 'Envío asignado' : 'Cotizando envío';

  const productos = t.productos.map(p => `${p.titulo} — ${money(p.precio)}`).join('<br>');

  content.innerHTML = `
    <div class="order-card">
      <div class="order-head">
        <span class="order-id">#${t.numeroOrden}</span>
        <span class="order-status ${statusClass}">${statusLabel}</span>
      </div>
      <p class="order-items">${productos}</p>
      <div class="order-head" style="margin-bottom:0">
        <span>Tienda: ${t.tiendaOrigen}</span>
        <span class="order-total">${money(t.desglose.totalPagar)}</span>
      </div>
      ${t.estado === 'pagado' ? `<p class="manifest-item-price" style="margin-top:8px">Subtotal ${money(t.desglose.subtotal)} + envío ${money(t.desglose.envio)}</p>` : ''}
    </div>
  `;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ---------- boot ----------
(function boot() {
  if (isLoggedIn()) {
    onLoggedIn();
  } else {
    showView('auth');
  }
})();
