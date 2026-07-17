<#
.SYNOPSIS
    Сборка и проверка «НТТ Калькулятор» без Docker.

.DESCRIPTION
    Поднимает продукт с нуля на локальной машине: зависимости, миграции, сид,
    сборка обоих приложений, smoke-проверка живого API.

    Путь БЕЗ Docker — основной для этой машины: Docker здесь не установлен
    (решение от 2026-07-16). docker-compose.yml существует, но не проверялся.

    Требуется: Node 20+, PostgreSQL 16 на localhost:5432, роль и БД из
    backend/.env (DATABASE_URL).

.PARAMETER SkipInstall
    Пропустить npm ci (зависимости уже установлены).

.PARAMETER SkipSeed
    Не пересевать справочники (прайс, веса труб).

.PARAMETER KeepRunning
    Не останавливать API после smoke-проверки.

.EXAMPLE
    .\verify.ps1
    .\verify.ps1 -SkipInstall -KeepRunning
#>
[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [switch]$SkipSeed,
    [switch]$KeepRunning
)

# 'Continue', а не 'Stop': в PS 5.1 вывод нативных команд в stderr
# (npm/npx пишут туда прогресс) при 'Stop' роняет скрипт даже при exit 0.
# Успех проверяем по $LASTEXITCODE явно.
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'ntt-calculator'

$script:step = 0
function Step($text) {
    $script:step++
    Write-Host ''
    Write-Host "── $script:step. $text " -ForegroundColor Cyan -NoNewline
    Write-Host ('─' * [Math]::Max(1, 58 - $text.Length)) -ForegroundColor DarkGray
}
function Ok($text) { Write-Host "   ✓ $text" -ForegroundColor Green }
function Fail($text) { Write-Host "   ✗ $text" -ForegroundColor Red; exit 1 }
function Info($text) { Write-Host "   $text" -ForegroundColor DarkGray }

# dotenv печатает баннер в stdout и ломает разбор вывода команд.
$env:DOTENV_CONFIG_QUIET = 'true'

# ── 0. Окружение ─────────────────────────────────────────────────────────────
Step 'Окружение'

$nodeVer = (node -v)
if (-not $?) { Fail 'Node не найден в PATH' }
$major = [int]($nodeVer -replace '^v(\d+).*', '$1')
if ($major -lt 20) { Fail "Нужен Node 20+, найден $nodeVer" }
Ok "Node $nodeVer"

if (-not (Test-Path (Join-Path $backend '.env'))) {
    Fail 'backend/.env не найден. Скопируйте backend/.env.example и укажите DATABASE_URL и JWT_SECRET'
}
Ok 'backend/.env на месте'

# Проверяем подключение к БД до всех тяжёлых шагов: падать здесь дешевле,
# чем после сборки фронта. Скрипт вынесен в файл — inline-JS через `node -e`
# в PowerShell разбирается ненадёжно (кавычки, регулярки, here-string).
Push-Location $backend
$dbCheck = & node 'tools/check-db.cjs'
$dbOk = $LASTEXITCODE -eq 0
Pop-Location
if (-not $dbOk) {
    Write-Host "   $dbCheck" -ForegroundColor DarkGray
    Fail 'Нет подключения к PostgreSQL. Создайте роль и БД из DATABASE_URL (см. README)'
}
Ok "PostgreSQL: $dbCheck"

# ── 1. Зависимости ───────────────────────────────────────────────────────────
if (-not $SkipInstall) {
    Step 'Зависимости'
    Push-Location $backend
    npm ci --no-audit --no-fund 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { Pop-Location; Fail 'npm ci упал в backend' }
    Pop-Location
    Ok 'backend'

    Push-Location $frontend
    npm ci --no-audit --no-fund 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Pop-Location
        # Типовая причина на Windows: работающий dev-сервер держит
        # node_modules\@esbuild\win32-x64\esbuild.exe, и npm ci падает с EPERM.
        Fail 'npm ci упал в ntt-calculator. Если ошибка EPERM на esbuild.exe — остановите dev-серверы (vite / ts-node-dev) и повторите'
    }
    Pop-Location
    Ok 'ntt-calculator'
} else {
    Step 'Зависимости — пропущены (-SkipInstall)'
}

# ── 2. БД: миграции и сид ────────────────────────────────────────────────────
Step 'База данных'
Push-Location $backend

npx prisma migrate deploy 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail 'prisma migrate deploy упал' }
Ok 'миграции применены'

npx prisma generate 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail 'prisma generate упал' }
Ok 'Prisma Client сгенерирован'

if (-not $SkipSeed) {
    # Сид идемпотентен: upsert пользователей + createMany(skipDuplicates).
    # Внутри есть проверки — падает, если ставка ФОТ или веса труб не нашлись.
    npx ts-node-dev --transpile-only prisma/seed.ts | Where-Object { $_ -notmatch '^\[INFO\]' } | ForEach-Object { Info $_ }
    if ($LASTEXITCODE -ne 0) { Pop-Location; Fail 'Сид упал' }
    Ok 'сид выполнен'
} else {
    Info 'сид пропущен (-SkipSeed)'
}
Pop-Location

# ── 3. Сборка ────────────────────────────────────────────────────────────────
Step 'Сборка'
Push-Location $backend
npx tsc --noEmit 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail 'tsc упал в backend' }
Ok 'backend: tsc без ошибок'
npm run build 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail 'сборка backend упала' }
Ok 'backend: dist собран'
Pop-Location

Push-Location $frontend
npx vue-tsc --build --force 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail 'vue-tsc упал' }
Ok 'ntt-calculator: vue-tsc без ошибок'
npx vite build 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail 'сборка фронта упала' }
Ok 'ntt-calculator: dist собран'
Pop-Location

# ── 4. Тесты движка ──────────────────────────────────────────────────────────
Step 'Тесты движка расчёта'
Push-Location $frontend
$testOut = npx vitest run
if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Host $testOut; Fail 'Тесты не прошли' }
$summary = ($testOut | Select-String -Pattern 'Tests\s+\d+ passed' | Select-Object -First 1)
Ok "$($summary -replace '\s+', ' ')".Trim()
Pop-Location

# ── 5. Smoke: живой API ──────────────────────────────────────────────────────
Step 'Smoke-проверка API'
Push-Location $backend
$api = Start-Process -FilePath 'node' -ArgumentList 'dist/app.js' -PassThru -NoNewWindow -RedirectStandardOutput (Join-Path $env:TEMP 'ntt-api.log') -RedirectStandardError (Join-Path $env:TEMP 'ntt-api.err')
Pop-Location

try {
    $up = $false
    foreach ($i in 1..40) {
        Start-Sleep -Milliseconds 500
        try {
            $h = Invoke-RestMethod 'http://localhost:3000/api/health' -TimeoutSec 2
            if ($h.status -eq 'ok') { $up = $true; break }
        } catch { }
    }
    if (-not $up) { Fail 'API не поднялся за 20 секунд. Лог: $env:TEMP\ntt-api.log' }
    Ok 'GET /api/health → ok'

    # Логин сидовым инженером — заодно проверяет, что сид отработал.
    $login = Invoke-RestMethod 'http://localhost:3000/api/auth/login' -Method Post `
        -ContentType 'application/json' `
        -Body (@{ email = 'engineer@ntt.local'; password = 'engineer123' } | ConvertTo-Json)
    if (-not $login.accessToken) { Fail 'Логин не вернул токен' }
    Ok 'POST /api/auth/login → токен получен'

    $auth = @{ Authorization = "Bearer $($login.accessToken)" }

    $prices = Invoke-RestMethod 'http://localhost:3000/api/prices' -Headers $auth
    if ($prices.Count -lt 900) { Fail "Прайс пуст или неполон: $($prices.Count) позиций" }
    Ok "GET /api/prices → $($prices.Count) позиций"

    # Ставка ФОТ — на ней стоит вся экономика (§9.5). Ищем тройным ключом.
    $fot = $prices | Where-Object { $_.category -eq 'ФОТ' -and $_.name -eq 'ФОТ' -and $_.unit -eq 'чел. ч' }
    if (-not $fot -or -not $fot.priceRub) { Fail 'Ставка ФОТ не найдена по ключу (ФОТ / ФОТ / чел. ч)' }
    Ok "ставка ФОТ → $($fot.priceRub) ₽/чел.ч"

    $weights = Invoke-RestMethod 'http://localhost:3000/api/refs/pipe-weights' -Headers $auth
    if ($weights.grp.Count -ne 162) { Fail "Веса GRP-труб: ожидалось 162, получено $($weights.grp.Count)" }
    Ok "GET /api/refs/pipe-weights → GRP $($weights.grp.Count), ПЭ $($weights.pe.Count)"

    # Контрольный ключ ОЛ3487: PN здесь — PN ТРУБЫ (автоподбор F7), не PN из ОЛ.
    $ref = $weights.grp | Where-Object { $_.dn -eq 3000 -and $_.pn -eq 0.6 -and $_.sn -eq 10000 }
    if (-not $ref -or [Math]::Abs($ref.kgPerM - 970.2) -gt 0.05) { Fail 'Контрольный вес DN3000/PN0,6/SN10000 ≠ 970,2 кг/пм' }
    Ok "контроль веса DN3000;0,6;10000 → $($ref.kgPerM) кг/пм"
} finally {
    if (-not $KeepRunning) {
        Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue
        Info 'API остановлен'
    }
}

# ── Итог ─────────────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '════════════════════════════════════════════════════════════' -ForegroundColor Green
Write-Host ' Проверка пройдена. Продукт собран и работает.' -ForegroundColor Green
Write-Host '════════════════════════════════════════════════════════════' -ForegroundColor Green
Write-Host ''
Write-Host ' Запуск для разработки:' -ForegroundColor White
Write-Host '   backend:        cd backend && npm run dev          → :3000'
Write-Host '   ntt-calculator: cd ntt-calculator && npm run dev   → :5173'
Write-Host ''
Write-Host ' Учётные записи (только для локальной разработки):' -ForegroundColor White
Write-Host '   admin@ntt.local    / admin123     [ADMIN]'
Write-Host '   manager@ntt.local  / manager123   [MANAGER]'
Write-Host '   engineer@ntt.local / engineer123  [ENGINEER]'
Write-Host ''
if ($KeepRunning) { Write-Host " API оставлен работать (PID $($api.Id)), порт 3000" -ForegroundColor Yellow; Write-Host '' }
