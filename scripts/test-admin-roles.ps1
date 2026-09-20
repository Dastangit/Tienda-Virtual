# ==========================================================
#  Script de prueba: Roles de Admin y Resolucion de Ordenes
#  Proyecto: Proxy Shopping
# ==========================================================
#  Requisito: el servidor debe estar corriendo (node server.js)
#  Uso: desde la carpeta del proyecto, ejecuta:
#     .\scripts\test-admin-roles.ps1
#
#  La primera vez que lo corras, el script te va a avisar que
#  vayas a MongoDB Atlas a cambiar el "role" del admin a "admin".
#  Las siguientes veces, si usas el mismo correo de admin, el
#  script simplemente inicia sesion con el.
# ==========================================================

$baseUrl = "http://localhost:5000"

function Write-Seccion($texto) {
    Write-Host "`n=== $texto ===" -ForegroundColor Cyan
}

# --- 1. Registrar un cliente normal (correo nuevo en cada corrida) ---
Write-Seccion "1. Registrando cliente"
$emailCliente = "cliente_$(Get-Random)@test.com"
$cliente = Invoke-RestMethod -Uri "$baseUrl/api/users/register" -Method Post -ContentType "application/json" -Body (@{
    name     = "Cliente Prueba"
    email    = $emailCliente
    password = "123456"
} | ConvertTo-Json)
$tokenCliente = $cliente.token
$headersCliente = @{ Authorization = "Bearer $tokenCliente" }
Write-Host "Cliente creado: $emailCliente"

# --- 2. Agregar un producto al carrito ---
# Primero lo buscamos/cacheamos con /api/search (ahi se fija el precio real),
# luego el carrito toma ese precio del servidor: ya NO se puede mandar un
# precio manual en el body de /api/carrito.
Write-Seccion "2. Buscando producto (se guarda en cache con su precio real)"
Invoke-RestMethod -Uri "$baseUrl/api/search" -Method Post -ContentType "application/json" -Body (@{
    originalId = "059035342X"
    source     = "amazon"
} | ConvertTo-Json) | Out-Null

Write-Seccion "2b. Agregando producto al carrito"
$item = @{
    originalId = "059035342X"
    source     = "amazon"
} | ConvertTo-Json
Invoke-RestMethod -Uri "$baseUrl/api/carrito" -Method Post -Headers $headersCliente -ContentType "application/json" -Body $item | Out-Null

# --- 3. Confirmar cotizacion (activo -> cotizando) ---
Write-Seccion "3. Confirmando cotizacion"
Invoke-RestMethod -Uri "$baseUrl/api/carrito/confirmar" -Method Put -Headers $headersCliente | Out-Null
Write-Host "Carrito del cliente pasado a 'cotizando'"

# --- 4. Registrar (o reutilizar) un admin ---
Write-Seccion "4. Preparando usuario admin"
$emailAdmin = "admin@test.com"   # usa siempre el mismo correo para no depender de Atlas cada vez
$passwordAdmin = "123456"

try {
    $admin = Invoke-RestMethod -Uri "$baseUrl/api/users/register" -Method Post -ContentType "application/json" -Body (@{
        name     = "Admin Prueba"
        email    = $emailAdmin
        password = $passwordAdmin
    } | ConvertTo-Json)
    Write-Host "Admin registrado por primera vez. Ve a MongoDB Atlas y cambia su 'role' a 'admin' antes de continuar, luego vuelve a correr el script." -ForegroundColor Yellow
    return
} catch {
    # Si ya existia, iniciamos sesion normalmente
    $admin = Invoke-RestMethod -Uri "$baseUrl/api/users/login" -Method Post -ContentType "application/json" -Body (@{
        email    = $emailAdmin
        password = $passwordAdmin
    } | ConvertTo-Json)
}
$tokenAdmin = $admin.token
$headersAdmin = @{ Authorization = "Bearer $tokenAdmin" }

# --- 5. Verificar que un cliente normal NO puede entrar al panel admin (se espera 403) ---
Write-Seccion "5. Verificando bloqueo de permisos (se espera error 403)"
try {
    Invoke-RestMethod -Uri "$baseUrl/api/admin/carritos" -Method Get -Headers $headersCliente
    Write-Host "ADVERTENCIA: esto NO deberia haber funcionado. Revisa el middleware 'admin'." -ForegroundColor Red
} catch {
    Write-Host "OK -> Bloqueado correctamente: $($_.ErrorDetails.Message)" -ForegroundColor Green
}

# --- 6. Listar cotizaciones pendientes como admin ---
Write-Seccion "6. Listando cotizaciones pendientes"
$carritos = Invoke-RestMethod -Uri "$baseUrl/api/admin/carritos" -Method Get -Headers $headersAdmin
$carritos | Format-Table _id, status, costoEnvio

if (-not $carritos -or $carritos.Count -eq 0) {
    Write-Host "No hay carritos en 'cotizando' todavia. Revisa los pasos 1-3." -ForegroundColor Yellow
    return
}
$carritoId = $carritos[0]._id

# --- 7. Asignar costo de envio (cotizando -> pagado) ---
Write-Seccion "7. Asignando costo de envio al carrito $carritoId"
$envio = @{ costoEnvio = 12.5 } | ConvertTo-Json
$resultado = Invoke-RestMethod -Uri "$baseUrl/api/admin/carritos/$carritoId/envio" -Method Put -Headers $headersAdmin -ContentType "application/json" -Body $envio
Write-Host "Carrito actualizado -> status: $($resultado.carrito.status), costoEnvio: $($resultado.carrito.costoEnvio)"

# --- 8. Probar casos de error ---
Write-Seccion "8. Probando error: reasignar envio a un carrito ya 'pagado' (se espera 400)"
try {
    Invoke-RestMethod -Uri "$baseUrl/api/admin/carritos/$carritoId/envio" -Method Put -Headers $headersAdmin -ContentType "application/json" -Body $envio
    Write-Host "ADVERTENCIA: esto NO deberia haber funcionado." -ForegroundColor Red
} catch {
    Write-Host "OK -> Rechazado correctamente: $($_.ErrorDetails.Message)" -ForegroundColor Green
}

Write-Seccion "Fin de las pruebas"
