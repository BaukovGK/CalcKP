# Дорожная карта разработки

## Текущее состояние — Sprint 1 ✓ · Sprint 2 ✓ · Sprint 3 ✓

```
[✓] Инициализация Vue 3 + TS + Pinia + Router
[✓] src/types/calculator.ts
[✓] src/data/nomenclature.ts      (~60 позиций НН)
[✓] src/engines/cost.ts           (rowSum, sgSum, gSum, bSum, recalcAuto)
[✓] src/stores/calculator.ts      (полный CRUD всех уровней)
[✓] src/components/calculator/CalcRow.vue  (автокомплит, drag-handle)
[✓] src/views/CalculatorView.vue  (sidebar + таблица + drag&drop)
[✓] src/assets/main.css           (dark theme, все классы)
```

---

## Sprint 2 — Стабилизация и разбивка компонентов

### Задача 1: Вынести CalcSubgroup.vue

```
Из CalculatorView.vue вырезать секцию subgroup-header-row
и всё что внутри → CalcSubgroup.vue

Props:
  sg: CalcSubgroup
  bundleColor: string
  groupId: string

Emits:
  sg-drag-start / sg-drag-over / sg-drag-leave / sg-drop
```

### Задача 2: Вынести CalcGroup.vue

```
Props:
  group: CalcGroup
  bundle: CalcBundle
  bundleIdx: number

Содержит: grp-hd + table с CalcSubgroup внутри
```

### Задача 3: Вынести CalcBundle.vue

```
Props:
  bundle: CalcBundle
  bundleIdx: number

Содержит: bnd-hd + CalcGroup[] + bft
Emits: bundle-drag-start / bundle-drag-over / bundle-drop
```

### Задача 4: ContextMenu.vue

```vue
<!-- src/components/ui/ContextMenu.vue -->
Props:
  items: CtxItem[]
  x: number
  y: number
  show: boolean

Emits: close

Используется в CalculatorView через v-if + teleport к body
```

### Задача 5: BaseModal.vue

```vue
Props:
  title: string
  show: boolean

Emits: close

Slot: default (тело модального), footer
```

---

## Sprint 3 — Аутентификация

### LoginView.vue

```
src/views/LoginView.vue

Форма: email + password
POST /api/auth/login → { accessToken, refreshToken, user }
Сохранить токены: localStorage
Redirect → /dashboard
```

### auth.store.ts

```typescript
// src/stores/auth.ts
interface AuthState {
  user: { id, name, role, email } | null
  accessToken: string | null
}

actions:
  login(email, password)   → POST /api/auth/login
  logout()                 → DELETE /api/auth/logout
  refresh()                → POST /api/auth/refresh
  checkAuth()              → валидация токена при старте
```

### router/index.ts — защита маршрутов

```typescript
router.beforeEach((to, from, next) => {
  const auth = useAuthStore()
  if (to.meta.requiresAuth && !auth.user) {
    next('/login')
  } else {
    next()
  }
})
```

### Маршруты

```
/login          → LoginView          (публичный)
/               → DashboardView      (manager+)
/calculator/:id → CalculatorView     (manager+)
/prices         → PricesView         (buyer+)
/admin          → AdminView          (admin only)
```

---

## Sprint 4 — Backend

### Инициализация

```bash
mkdir backend && cd backend
npm init -y
npm install express prisma @prisma/client zod jose bcryptjs winston
npm install -D typescript @types/express @types/node ts-node-dev
npx tsc --init
npx prisma init
```

### prisma/schema.prisma — ключевые модели

```prisma
model User {
  id           String     @id @default(uuid())
  email        String     @unique
  name         String
  role         Role       @default(VIEWER)
  passwordHash String
  isActive     Boolean    @default(true)
  createdAt    DateTime   @default(now())
}

enum Role { ADMIN MANAGER ENGINEER BUYER VIEWER }

model Estimate {
  id          String     @id @default(uuid())
  title       String
  deviceType  DeviceType
  status      Status     @default(DRAFT)
  surveyData  Json
  totalRub    Float?
  authorId    String
  author      User       @relation(fields:[authorId], references:[id])
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
}

enum DeviceType { KNS EMK KOL }
enum Status     { DRAFT CALC REVIEW APPROVED REJECTED }

model PriceItem {
  id         String   @id @default(uuid())
  lookupKey  String   @unique
  category   String
  name       String
  unit       String
  priceRub   Float?
  supplier   String?
  updatedAt  DateTime @updatedAt
}
```

### Запуск backend (dev)

```bash
cd backend
npx prisma migrate dev --name init
npx prisma generate
npx ts-node-dev src/app.ts
```

---

## Sprint 5 — Dashboard и API-интеграция

### DashboardView.vue

```
Список смет текущего менеджера
Фильтры: статус, дата, тип оборудования
Кнопка "Новая смета" → опросный лист
Клик на смету → /calculator/:id
```

### API-клиент (src/api/client.ts)

```typescript
import axios from 'axios'
import { useAuthStore } from '@/stores/auth'

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL })

// Токен в каждый запрос
api.interceptors.request.use(config => {
  const auth = useAuthStore()
  if (auth.accessToken)
    config.headers.Authorization = `Bearer ${auth.accessToken}`
  return config
})

// Авто-refresh при 401
api.interceptors.response.use(
  r => r,
  async error => {
    if (error.response?.status === 401 && !error.config._retry) {
      error.config._retry = true
      await useAuthStore().refresh()
      return api(error.config)
    }
    return Promise.reject(error)
  }
)

export default api
```

---

## Sprint 6 — Реестр цен (PricesView)

```
Доступ: только BUYER + ADMIN

Таблица: категория / наименование / ЕИ / цена / поставщик / дата обновления
Inline-редактирование цены (input с blur-сохранением)
Фильтр по категории
Выделение устаревших позиций (> 90 дней)
Кнопка "Импорт из Excel" → загрузка xlsx → PATCH /api/prices/import
```

---

## Sprint 7 — Экспорт в Excel

```bash
npm install exceljs
```

```typescript
// src/utils/exportExcel.ts
import ExcelJS from 'exceljs'
import type { CalcBundle } from '@/types/calculator'
import { bSum, gSum, sgSum, rowSum, fmt } from '@/engines/cost'

export async function exportToExcel(bundles: CalcBundle[]) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Смета')

  // Заголовок
  ws.addRow(['№', 'Категория', 'Наименование', 'Закупка', 'Кол-во', 'ЕИ', 'Цена', 'Сумма', 'Примечание'])

  for (const b of bundles) {
    // Строка связки
    ws.addRow([b.title]).font = { bold: true, color: { argb: 'FFEEAA28' } }

    for (const g of b.groups) {
      ws.addRow([g.title]).font = { bold: true }

      for (const sg of g.subgroups) {
        ws.addRow(['', '', sg.title]).font = { italic: true }

        for (const r of sg.rows) {
          ws.addRow(['', r.category, r.name, r.purchase, r.qty, r.unit, r.price, rowSum(r), r.note])
        }
      }
    }
  }

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: 'калькулятор_нтт.xlsx',
  })
  a.click()
  URL.revokeObjectURL(a.href)
}
```

---

## Sprint 8 — Docker и деплой

```bash
# docker-compose.yml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ntt
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: ntt_estimates

  redis:
    image: redis:7-alpine

  backend:
    build: ./backend
    environment:
      DATABASE_URL: postgresql://ntt:secret@postgres:5432/ntt_estimates
      REDIS_URL: redis://redis:6379

  frontend:
    build: ./frontend
    # статика через nginx

  nginx:
    image: nginx:alpine
    ports: ["80:80", "443:443"]
```

```bash
# Запуск локально
docker compose up -d
docker compose exec backend npx prisma migrate deploy
docker compose exec backend npx ts-node prisma/seed.ts
```

---

## Переменные окружения

### frontend/.env
```
VITE_API_URL=http://localhost:3000/api
VITE_APP_VERSION=1.0.0
```

### backend/.env
```
DATABASE_URL=postgresql://ntt:secret@localhost:5432/ntt_estimates
REDIS_URL=redis://localhost:6379
NODE_ENV=development
PORT=3000
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=7d
```

---

## Приоритеты на ближайшую сессию

```
1. [x] Исправить src/stores/calculator.ts (был пустой)
2. [x] Sprint 2 — декомпозиция: CalcSubgroup / CalcGroup / CalcBundle / ContextMenu / BaseModal
3. [x] Sprint 3 — LoginView.vue + auth.store.ts + router guards + .env
4. [ ] Sprint 4 — Инициализация backend (Node.js + Express + Prisma + PostgreSQL)
5. [ ] Sprint 5 — DashboardView + API-интеграция (axios, estimates store)
```
