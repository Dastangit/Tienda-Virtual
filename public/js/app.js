// ============================================
// Tienda Virtual — app.js (vanilla, sin build)
// ============================================
const API = '';
const TOKEN_KEY = 'tv_token';
const ROLE_KEY = 'tv_role';
const MAX_MODAL_PHOTOS = 5;
// A dónde va el cliente a coordinar el pago cuando su pedido está "Listo para pagar".
// Cambia esta URL si prefieres otro canal.
const PAYMENT_CONTACT_URL = 'https://wa.me/16055003653';

const state = {
  token: localStorage.getItem(TOKEN_KEY) || null,
  role: localStorage.getItem(ROLE_KEY) || null,
  source: 'amazon',
  results: [],      // resultados cargados de la ultima busqueda (todas las paginas)
  lastSearch: null, // { query, source, sort, minPrice, maxPrice, page, hayMas }
  filters: { sets: false, minPieces: 0, rating4: false, discount: false, category: '' },  modalItem: null, // { originalId, source } del producto que esta abierto en el modal
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
    // Sesion vencida o invalida (no aplica al login, donde 401 = credenciales malas)
    if (res.status === 401 && state.token && !path.startsWith('/api/users/')) {
      logout();
      toast('Tu sesión expiró. Inicia sesión de nuevo.');
      throw new Error('Sesión expirada');
    }
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

function logout() {
  setToken(null);
  setRole(null);
  $('#appNav').hidden = true;
  showView('auth');
}

// ---------- views ----------
const VIEWS = ['auth', 'search', 'cart', 'orders', 'services'];

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
  showView('search');
  refreshCartCount();
}

// ---------- search (por palabra clave, con filtros) ----------
// Cada busqueda cuesta 1 credito y trae muchos productos (Shein hasta 120). Los filtros de
// abajo (sets, piezas, valoracion, descuento, categoria) se aplican aqui, GRATIS, sobre lo ya
// cargado. El rango de precio y el orden de Shein si viajan al servidor al buscar.
const SORT_GROUP = { cheapest: 'precio', unit: 'precio', popular: 'popular', rated: 'popular', relevance: 'relevancia' };
const NO_FILTERS = { sets: false, minPieces: 0, rating4: false, discount: false, category: '' };

$all('.source-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $all('.source-btn').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    state.source = btn.dataset.source;
    resetSearchResults();
  });
});

function resetSearchResults() {
  state.results = [];
  state.lastSearch = null;
  $('#searchResults').hidden = true;
  $('#resultsCount').hidden = true;
  $('#resultFilters').hidden = true;
  $('#loadMoreBtn').hidden = true;
}

function sortResults(list, sort) {
  const price = (a, b) => a.precioFinalCliente - b.precioFinalCliente;
  const arr = [...list];
  if (sort === 'cheapest') return arr.sort(price);
  if (sort === 'unit') return arr.sort((a, b) => (a.precioUnidadCliente - b.precioUnidadCliente) || price(a, b));
  if (sort === 'rated') return arr.sort((a, b) => (b.rating - a.rating) || (b.reviews - a.reviews));
  return arr.sort((a, b) => a.posicion - b.posicion); // mas vendidos / relevancia: orden de la tienda
}

async function runSearch({ append = false } = {}) {
  setError('searchForm', '');
  const prev = state.lastSearch;
  const params = append && prev ? { query: prev.query, source: prev.source, sort: prev.sort, minPrice: prev.minPrice, maxPrice: prev.maxPrice } : {
    query: $('#searchInput').value.trim(),
    source: state.source,
    sort: $('#sortSelect').value,
    minPrice: $('#minPrice').value,
    maxPrice: $('#maxPrice').value,
  };
  if (!params.query) return;
  const page = append && prev ? prev.page + 1 : 1;

  const submitBtn = $('#searchForm button[type="submit"]');
  const moreBtn = $('#loadMoreBtn');
  submitBtn.disabled = true;
  moreBtn.disabled = true;
  if (append) {
    moreBtn.textContent = 'Cargando…';
  } else {
    submitBtn.textContent = 'Buscando…';
    $('#searchResults').hidden = true;
    $('#resultsCount').hidden = true;
    $('#resultFilters').hidden = true;
    moreBtn.hidden = true;
  }

  try {
    const data = await api('/api/search/query', { method: 'POST', body: JSON.stringify({ ...params, page }) });
    const nuevos = data.resultados || [];
    if (append) {
      const vistos = new Set(state.results.map(r => r.originalId));
      state.results = state.results.concat(nuevos.filter(r => !vistos.has(r.originalId)));
    } else {
      state.results = nuevos;
      state.filters.category = '';
    }
    state.lastSearch = { ...params, page, hayMas: !!data.hayMas };
    state.results = sortResults(state.results, params.sort);
    buildCategoryOptions();
    renderSearchResults();
  } catch (err) {
    setError('searchForm', err.message);
    if (append) { moreBtn.disabled = false; moreBtn.textContent = 'Cargar más resultados'; }
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Buscar';
  }
}

$('#searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  runSearch();
});

$('#loadMoreBtn').addEventListener('click', () => runSearch({ append: true }));

// Cambiar el orden: si Shein tiene que traer otro "grupo" de resultados (ej. de baratos a
// mas vendidos) se vuelve a buscar; si no, se reordena lo ya cargado sin gastar nada.
$('#sortSelect').addEventListener('change', () => {
  const ls = state.lastSearch;
  if (!ls) return;
  const nuevo = $('#sortSelect').value;
  if (ls.source === 'shein' && SORT_GROUP[nuevo] !== SORT_GROUP[ls.sort]) {
    runSearch();
    return;
  }
  ls.sort = nuevo;
  state.results = sortResults(state.results, nuevo);
  renderSearchResults();
});

// ----- filtros sobre los resultados cargados -----
function visibleResults() {
  const f = state.filters;
  return state.results.filter(r =>
    (!f.sets || r.esSet) &&
    (!f.minPieces || r.piezas >= f.minPieces) &&
    (!f.rating4 || r.rating >= 4) &&
    (!f.discount || r.discountPercent > 0) &&
    (!f.category || r.category === f.category)
  );
}

function activeFilterCount() {
  const f = state.filters;
  return [f.sets, f.minPieces, f.rating4, f.discount, f.category].filter(Boolean).length;
}

function buildCategoryOptions() {
  const counts = {};
  state.results.forEach(r => { if (r.category) counts[r.category] = (counts[r.category] || 0) + 1; });
  const names = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  const sel = $('#fCategory');
  sel.innerHTML = '';
  sel.add(new Option('Todas', ''));
  names.forEach(n => sel.add(new Option(`${n} (${counts[n]})`, n)));
  if (!names.includes(state.filters.category)) state.filters.category = '';
  sel.value = state.filters.category;
  $('#fCategoryWrap').hidden = names.length < 2;
}

function syncFilterControls() {
  const f = state.filters;
  $('#fSets').classList.toggle('is-active', f.sets);
  $('#fRating').classList.toggle('is-active', f.rating4);
  $('#fDiscount').classList.toggle('is-active', f.discount);
  $('#fMinPieces').value = String(f.minPieces);
  $('#fClear').hidden = activeFilterCount() === 0;
}

$('#fSets').addEventListener('click', () => { state.filters.sets = !state.filters.sets; renderSearchResults(); });
$('#fRating').addEventListener('click', () => { state.filters.rating4 = !state.filters.rating4; renderSearchResults(); });
$('#fDiscount').addEventListener('click', () => { state.filters.discount = !state.filters.discount; renderSearchResults(); });
$('#fMinPieces').addEventListener('change', (e) => { state.filters.minPieces = Number(e.target.value); renderSearchResults(); });
$('#fCategory').addEventListener('change', (e) => { state.filters.category = e.target.value; renderSearchResults(); });
$('#fClear').addEventListener('click', () => {
  state.filters = { ...NO_FILTERS };
  $('#fCategory').value = '';
  renderSearchResults();
});

function formatCount(n) {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return String(n);
}

function renderSearchResults() {
  const grid = $('#searchResults');
  const count = $('#resultsCount');
  const moreBtn = $('#loadMoreBtn');
  grid.innerHTML = '';

  const total = state.results.length;
  if (total === 0) {
    count.hidden = false;
    count.textContent = 'No encontramos productos para esa búsqueda. Prueba con otras palabras o amplía el rango de precio.';
    grid.hidden = true;
    $('#resultFilters').hidden = true;
    moreBtn.hidden = true;
    return;
  }

  const visibles = visibleResults();
  $('#resultFilters').hidden = false;
  syncFilterControls();

  count.hidden = false;
  if (visibles.length === 0) {
    count.textContent = `Ningún producto cumple tus filtros (${total} cargados). Quita alguno o carga más resultados.`;
  } else if (activeFilterCount() > 0) {
    count.textContent = `${visibles.length} de ${total} resultados con tus filtros — toca uno para ver más fotos`;
  } else {
    count.textContent = `${total} resultados — toca uno para ver más fotos`;
  }

  visibles.forEach(item => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'result-item';
    const setBadge = item.esSet ? `<span class="badge badge-set">${item.piezas > 1 ? `Set x${item.piezas}` : 'Set'}</span>` : '';
    const discBadge = item.discountPercent > 0 ? `<span class="badge badge-discount">-${item.discountPercent}%</span>` : '';
    const unit = item.piezas > 1 ? `<span class="result-item-unit">${money(item.precioUnidadCliente)} c/u</span>` : '';
    const rating = item.rating > 0 ? `<span class="result-item-rating">★ ${Number(item.rating).toFixed(1)}${item.reviews ? ` (${formatCount(item.reviews)})` : ''}</span>` : '';
    const tag = item.badge ? `<span class="result-item-tag">${escapeHtml(item.badge)}</span>` : '';
    card.innerHTML = `
      <div class="result-media">
        <img src="${item.image || ''}" alt="" loading="lazy">
        ${setBadge}${discBadge}
      </div>
      <div class="result-item-body">
        <p class="result-item-title">${escapeHtml(item.title)}</p>
        ${tag}
        <span class="result-item-price">${money(item.precioFinalCliente)}</span>
        ${unit}
        ${rating}
      </div>
    `;
    card.addEventListener('click', () => openProductModal(item));
    grid.appendChild(card);
  });

  grid.hidden = visibles.length === 0;
  moreBtn.hidden = !state.lastSearch?.hayMas;
  moreBtn.disabled = false;
  moreBtn.textContent = 'Cargar más resultados';
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

function renderModalColors(colors) {
  const el = $('#modalColors');
  if (!colors || colors.length === 0) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  el.innerHTML = colors.map(c => `
    <button type="button" class="color-chip ${c.current ? 'is-active' : ''}" data-link="${escapeHtml(c.link)}" title="${escapeHtml(c.name)}">
      <img src="${c.image}" alt="${escapeHtml(c.name)}" loading="lazy">
    </button>
  `).join('');

  $all('.color-chip', el).forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('is-active')) return;
      openProductModal({ originalId: btn.dataset.link, source: 'shein' });
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
  state.modalColorName = null;

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
    renderModalColors(p.colors);
    renderModalSizes(p.sizes);
    state.modalColorName = (p.colors || []).find(c => c.current)?.name || null;
    $('#modalSource').textContent = p.source.toUpperCase();
    $('#modalTitle').textContent = p.title;
    $('#modalPrice').textContent = money(p.precioFinalCliente);

    $('#modalLoading').hidden = true;
    $('#modalBody').hidden = false;
  } catch (err) {
    $('#modalLoading').hidden = true;
    $('#modalBody').hidden = false;
    $('#modalGallery').innerHTML = '';
    $('#modalColors').hidden = true;
    $('#modalSizes').hidden = true;
    $('#modalError').textContent = err.message;
  }
}

function closeProductModal() {
  $('#productModal').hidden = true;
  document.body.style.overflow = '';
  state.modalItem = null;
  state.modalSize = null;
  state.modalColorName = null;
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
      body: JSON.stringify({ ...state.modalItem, size: state.modalSize || undefined, color: state.modalColorName || undefined })
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
        <span class="manifest-item-price">${money(item.precioFinalCliente)} · ${item.source.toUpperCase()}${item.size ? ' · Talla ' + escapeHtml(item.size) : ''}${item.color ? ' · ' + escapeHtml(item.color) : ''}</span>
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
    const statusClass = `is-${t.estado}`;
    const statusLabel = {
      cotizando: 'Cotizando envío',
      pendiente_pago: 'Listo para pagar',
      pagado: 'Pagado',
      completado: 'Completado'
    }[t.estado] || t.estado;
    const fecha = new Date(t.fecha).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });

    const productosHtml = t.productos.map(p => `
      <div class="order-product">
        <img src="${p.imagen || ''}" alt="" loading="lazy">
        <span class="order-product-title">${escapeHtml(p.titulo)}${p.talla ? ' · Talla ' + escapeHtml(p.talla) : ''}${p.color ? ' · ' + escapeHtml(p.color) : ''}</span>
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
        ${t.estado === 'pendiente_pago' ? `
          <p class="manifest-item-price" style="margin-top:8px">Tu total ya está listo. Escríbenos para coordinar el pago y empezamos tu compra.</p>
          <a class="btn btn-stamp btn-sm" style="margin-top:8px" href="${PAYMENT_CONTACT_URL}" target="_blank" rel="noopener noreferrer">Coordinar pago de ${money(t.desglose.totalPagar)}</a>` : ''}
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
