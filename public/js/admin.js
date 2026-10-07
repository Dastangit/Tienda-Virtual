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

// Enlace a la pagina real del producto en la tienda de origen.
// Amazon: el originalId es el ASIN. Shein: el originalId es la URL del producto.
// Por seguridad solo se aceptan enlaces https a amazon.com / shein.com.
function productUrl(item) {
  const id = String(item?.originalId || '').trim();
  if (!id) return '';
  try {
    if (item.source === 'amazon') {
      if (!/^[A-Za-z0-9]{10}$/.test(id)) return '';
      return `https://www.amazon.com/dp/${id}`;
    }
    if (item.source === 'shein') {
      const u = new URL(id);
      const hostOk = u.hostname === 'shein.com' || u.hostname.endsWith('.shein.com');
      return (u.protocol === 'https:' && hostOk) ? u.href : '';
    }
  } catch (_) { /* URL invalida */ }
  return '';
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
    const titulos = { cotizando: 'Cotizaciones pendientes', pendiente_pago: 'Esperando que el cliente pague', pagado: 'Pedidos pagados, por completar', completado: 'Pedidos completados' };
    $('#dashboardTitle').textContent = titulos[state.status] || '';
    loadQuotes();
  });
});

async function loadStats() {
  try {
    const s = await api('/api/admin/stats');
    const m = s.mesActual;
    $('#statsGrid').innerHTML = `
      <div class="stat-card is-accent"><span class="stat-label">Facturado este mes</span><span class="stat-value">${money(m.facturado)}</span><span class="stat-sub">${m.pedidos} pedido(s) · margen ${money(m.margen)}</span></div>
      <div class="stat-card"><span class="stat-label">Por cobrar</span><span class="stat-value">${money(s.porCobrar.monto)}</span><span class="stat-sub">${s.porCobrar.pedidos} pedido(s) esperando pago</span></div>
      <div class="stat-card"><span class="stat-label">Cotizando</span><span class="stat-value">${s.conteos.cotizando}</span><span class="stat-sub">falta asignar envío</span></div>
      <div class="stat-card"><span class="stat-label">Pagados</span><span class="stat-value">${s.conteos.pagado}</span><span class="stat-sub">por comprar/entregar</span></div>
      <div class="stat-card"><span class="stat-label">Completados</span><span class="stat-value">${s.conteos.completado}</span><span class="stat-sub">entregados</span></div>
    `;
    $('#statsGrid').hidden = false;
    $('#statsMonths').innerHTML = s.meses.map(x =>
      `<tr><td>${escapeHtml(x.mes)}</td><td>${x.pedidos}</td><td>${money(x.facturado)}</td><td>${money(x.margen)}</td></tr>`
    ).join('');
    $('#statsDetails').hidden = s.meses.length === 0;
  } catch (_) {
    // El resumen es secundario: si falla, el panel de pedidos sigue funcionando.
    $('#statsGrid').hidden = true;
    $('#statsDetails').hidden = true;
  }
}

async function loadQuotes() {
  loadStats();
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
  $all('.quote-confirm-pago-btn', list).forEach(btn => {
    btn.addEventListener('click', onConfirmPagoClick);
  });
  $all('.price-check-btn', list).forEach(btn => {
    btn.addEventListener('click', onPriceCheckClick);
  });
}

// Enlace de WhatsApp (wa.me) con el aviso ya escrito para el cliente. No usa API ni
// cuesta nada: el admin solo toca el botón y envía el mensaje desde su propio WhatsApp.
function whatsappAvisoUrl(carrito, subtotal) {
  const digits = String(carrito.user?.phone || '').replace(/\D/g, '');
  if (digits.length < 8) return '';
  const envio = carrito.costoEnvio || 0;
  const nombre = (carrito.user?.name || '').split(' ')[0];
  const texto = `Hola${nombre ? ' ' + nombre : ''} 👋 Tu pedido #${String(carrito._id).slice(-6)} ya tiene el total listo para pagar: ${money(subtotal + envio)} (productos ${money(subtotal)} + envío ${money(envio)}). Entra a "Mis cotizaciones" en ${window.location.origin} para verlo y coordinar el pago.`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(texto)}`;
}

function renderQuoteCard(carrito) {
  const subtotal = carrito.items.reduce((acc, i) => acc + i.precioFinalCliente, 0);
  const tienda = (carrito.items[0]?.source || '').toUpperCase();
  const fecha = new Date(carrito.updatedAt).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  const productosHtml = carrito.items.map(i => {
    const url = productUrl(i);
    const tiendaNombre = i.source === 'shein' ? 'Shein' : 'Amazon';
    const opciones = [i.size && `Talla: ${i.size}`, i.color && `Color: ${i.color}`].filter(Boolean).join(' · ');
    return `
    <div class="order-product">
      <img src="${i.image || ''}" alt="" loading="lazy">
      <span class="order-product-title">
        ${escapeHtml(i.title)}
        ${opciones ? `<span class="order-product-opts">${escapeHtml(opciones)}</span>` : ''}
        ${url ? `<a class="order-product-link" href="${url.replace(/"/g, '%22')}" target="_blank" rel="noopener noreferrer">Ver en ${tiendaNombre} ↗</a>` : ''}
      </span>
      <span class="order-product-price">${money(i.precioFinalCliente)}</span>
    </div>
  `;
  }).join('');

  let accionHtml = '';
  if (carrito.status === 'cotizando') {
    accionHtml = `
      <form class="quote-assign-form">
        <input type="number" name="costoEnvio" step="0.01" min="0" placeholder="Costo de envío" required>
        <button type="submit" class="btn btn-stamp btn-sm">Asignar costo de envío</button>
      </form>
    `;
  } else if (carrito.status === 'pendiente_pago') {
    const waUrl = whatsappAvisoUrl(carrito, subtotal);
    accionHtml = `
      <div class="quote-assign-form">
        <span class="manifest-item-price">Envío: ${money(carrito.costoEnvio)} · Total: ${money(subtotal + (carrito.costoEnvio || 0))}</span>
        <div class="quote-notify-row">
          ${waUrl ? `<a class="btn btn-sm btn-whatsapp" href="${waUrl}" target="_blank" rel="noopener noreferrer">Avisar por WhatsApp</a>` : ''}
          <button type="button" class="btn btn-stamp btn-sm quote-confirm-pago-btn">Confirmar pago recibido</button>
        </div>
      </div>
    `;
  } else if (carrito.status === 'pagado') {
    accionHtml = `
      <div class="quote-assign-form">
        <span class="manifest-item-price">Envío: ${money(carrito.costoEnvio)} · Total: ${money(subtotal + (carrito.costoEnvio || 0))}</span>
        <button type="button" class="btn btn-ghost btn-sm price-check-btn">Verificar precios actuales</button>
        <button type="button" class="btn btn-stamp btn-sm quote-complete-btn">Marcar como completado</button>
      </div>
      <div class="price-check-result" hidden></div>
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
    // Saltamos a la pestaña "Pendiente de pago", donde está el botón para avisarle al cliente
    $('.admin-tabs [data-status="pendiente_pago"]').click();
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

async function onConfirmPagoClick(e) {
  const card = e.target.closest('.quote-card');
  const cartId = card.dataset.cartId;
  const errId = `quote-${cartId}`;
  setError(errId, '');
  e.target.disabled = true;
  try {
    const data = await api(`/api/admin/carritos/${cartId}/confirmar-pago`, { method: 'PUT' });
    toast(data.mensaje || 'Pago confirmado');
    loadQuotes();
  } catch (err) {
    setError(errId, err.message);
    e.target.disabled = false;
  }
}

async function onPriceCheckClick(e) {
  const card = e.target.closest('.quote-card');
  const cartId = card.dataset.cartId;
  const resultEl = $('.price-check-result', card);
  e.target.disabled = true;
  e.target.textContent = 'Verificando…';
  resultEl.hidden = true;
  try {
    const data = await api(`/api/admin/carritos/${cartId}/verificar-precios`);
    resultEl.innerHTML = data.items.map(it => {
      if (it.error) {
        return `<p class="price-check-line is-error">${escapeHtml(it.titulo)}: ${escapeHtml(it.error)}</p>`;
      }
      if (!it.cambio) {
        return `<p class="price-check-line is-ok">${escapeHtml(it.titulo)}: sin cambios (${money(it.precioActual)})</p>`;
      }
      const signo = it.diferencia > 0 ? '+' : '';
      return `<p class="price-check-line is-changed">${escapeHtml(it.titulo)}: ${money(it.precioCotizado)} → ${money(it.precioActual)} (${signo}${money(it.diferencia)})</p>`;
    }).join('');
    resultEl.hidden = false;
  } catch (err) {
    toast(err.message);
  } finally {
    e.target.disabled = false;
    e.target.textContent = 'Verificar precios actuales';
  }
}


(function boot() {
  if (state.token) {
    onLoggedIn('');
  } else {
    showView('auth');
  }
})();
