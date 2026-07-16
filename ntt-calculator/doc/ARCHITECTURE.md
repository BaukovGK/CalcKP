# НТТ Калькулятор — Архитектура системы

## 1. Обзор

Веб-приложение для расчёта стоимости стеклокомпозитного ёмкостного оборудования.

**Типы оборудования:** КНС (канализационная насосная станция), Ёмкость, Колодец  
**Материал:** стеклокомпозит (СК/НПС), не металл — все расчёты через нормо-часы и кг ламинации

**Три рабочих пространства:**
- Коммерческий отдел (менеджер) — создаёт и рассчитывает сметы
- Технический отдел (инженер) — ведёт шаблоны и справочники
- Отдел закупок (buyer) — обновляет прайс-лист независимо

---

## 2. Технологический стек

### Frontend
| Технология | Версия | Роль |
|---|---|---|
| Vue 3 | 3.6 | UI-фреймворк, Composition API |
| TypeScript | 5.x | Типизация |
| Vite | 6.x | Сборщик и dev-сервер |
| Pinia | 2.x | Глобальное состояние |
| Vue Router | 4.x | Маршрутизация SPA |
| Axios | 1.x | HTTP-клиент |
| ExcelJS | 4.x | Экспорт в Excel |

### Backend
| Технология | Версия | Роль |
|---|---|---|
| Node.js | 20 LTS | Runtime |
| Express | 4.x | HTTP-сервер |
| TypeScript | 5.x | Типизация |
| Prisma ORM | 5.x | Работа с БД, миграции |
| PostgreSQL | 16.x | Основная БД |
| Redis | 7.x | Кэш расчётов |
| Jose | 5.x | JWT RS256 |
| Zod | 3.x | Валидация входных данных |

### Инфраструктура
| Компонент | Решение |
|---|---|
| Контейнеризация | Docker + Docker Compose |
| Reverse proxy | Nginx |
| SSL | Let's Encrypt |
| CI/CD | GitHub Actions |
| Бэкапы | pg_dump + cron |

---

## 3. Структура монорепозитория

```
ntt-estimates/
├── frontend/                        Vue 3 приложение
│   └── src/
│       ├── main.ts                  Точка входа
│       ├── App.vue                  Корневой компонент
│       ├── router/index.ts          Маршруты
│       ├── assets/main.css          Все стили (CSS-переменные, dark theme)
│       │
│       ├── types/
│       │   └── calculator.ts        Все TypeScript-типы
│       │
│       ├── data/
│       │   └── nomenclature.ts      Справочник НН (NOM_DB), константы
│       │
│       ├── engines/
│       │   └── cost.ts              Чистые функции расчёта (rowSum, recalcAuto...)
│       │
│       ├── stores/
│       │   ├── calculator.ts        Состояние калькулятора (Pinia)
│       │   ├── auth.ts              Авторизация, токен, роль
│       │   └── prices.ts            Прайс-лист
│       │
│       ├── components/
│       │   ├── calculator/
│       │   │   ├── CalcRow.vue      Строка таблицы с автокомплитом
│       │   │   ├── CalcSubgroup.vue Заголовок подгруппы (будущий компонент)
│       │   │   ├── CalcGroup.vue    Заголовок группы (будущий компонент)
│       │   │   └── CalcBundle.vue   Карточка связки (будущий компонент)
│       │   └── ui/
│       │       ├── ContextMenu.vue  Универсальное контекстное меню
│       │       ├── BaseModal.vue    Базовый модальный диалог
│       │       └── ColorPicker.vue  Выбор цвета связки
│       │
│       └── views/
│           ├── CalculatorView.vue   Главная страница (готова)
│           ├── LoginView.vue        Страница входа
│           ├── DashboardView.vue    Список смет
│           ├── PricesView.vue       Реестр цен (отдел закупок)
│           └── AdminView.vue        Управление пользователями
│
├── backend/
│   └── src/
│       ├── app.ts                   Express-приложение
│       ├── middleware/
│       │   ├── auth.ts              JWT-проверка
│       │   ├── rbac.ts              Проверка ролей
│       │   └── validate.ts          Zod-валидация
│       ├── routes/
│       │   ├── auth.routes.ts
│       │   ├── estimates.routes.ts
│       │   ├── prices.routes.ts
│       │   └── refs.routes.ts
│       ├── services/
│       │   ├── calculation.service.ts   Серверный BOM-расчёт
│       │   └── prices.service.ts
│       ├── engines/                     Серверные движки (канонические)
│       │   ├── BOMEngine.ts
│       │   ├── CostEngine.ts
│       │   └── rules/
│       │       ├── kns.rules.ts
│       │       ├── emk.rules.ts
│       │       └── kol.rules.ts
│       └── data/                        Справочные JSON-таблицы
│           ├── pipeWeights.json
│           ├── nozzleParams.json
│           └── layoutConfigs.json
│
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│
└── docker-compose.yml
```

---

## 4. Модель данных — калькулятор

### Иерархия (4 уровня)

```
CalcBundle          ← Связка (цветная карточка)
  └── CalcGroup[]   ← Группа (секция таблицы, sticky заголовок)
        └── CalcSubgroup[]  ← Подгруппа (операция: труба, дно, ламинация...)
              └── CalcRow[] ← Строки: МАТ → РАБ → ФОТ → ЗАК
```

### Типы строк (RowType)

| Тип | Цвет | Описание |
|---|---|---|
| МАТ | Янтарный | Материал собственного производства |
| РАБ | Бирюзовый | Работа/ламинация/формовка |
| ФОТ | Фиолетовый | Фонд оплаты труда 1207.8 руб/ч·ч |
| ЗАК | Зелёный | Закупная позиция |

### Автопересчёт ФОТ

```
row.isAuto        = true
row.autoParentId  = id родительской строки (МАТ или РАБ)
row.autoCoeff     = коэффициент

qty_ФОТ = qty_родителя × autoCoeff

Коэффициенты (из Excel-макросов):
  мех. формовка   → 0.28
  ламинирование   → 0.56
  прочие работы   → 1.00
```

---

## 5. Роли и доступ

| Действие | manager | engineer | buyer | viewer | admin |
|---|:---:|:---:|:---:|:---:|:---:|
| Создать/рассчитать смету | ✓ | — | — | — | ✓ |
| Редактировать шаблоны | — | ✓ | — | — | ✓ |
| Просмотр смет (своих) | ✓ | — | — | ✓ | ✓ |
| Просмотр всех смет | — | — | — | — | ✓ |
| Обновить прайс-лист | — | — | ✓ | — | ✓ |
| Импорт цен из Excel | — | — | ✓ | — | ✓ |
| Управление пользователями | — | — | — | — | ✓ |
| Аудит-лог | — | — | — | — | ✓ |

---

## 6. API — эндпоинты

```
POST   /api/auth/login
POST   /api/auth/refresh
DELETE /api/auth/logout

GET    /api/estimates              список смет
POST   /api/estimates              создать
GET    /api/estimates/:id          смета + активный снапшот
PATCH  /api/estimates/:id/survey   обновить → авторасчёт

GET    /api/prices                 реестр цен
PATCH  /api/prices/:id             обновить цену
POST   /api/prices/import          импорт xlsx

GET    /api/refs/nomenclature      справочник НН
GET    /api/refs/pipe-weights      веса труб
```

---

## 7. Схема БД (основные таблицы)

```
User            — пользователи, роли
Estimate        — смета: deviceType, status, surveyData (JSON)
EstimateSnapshot — снапшот расчёта: версия, priceListVersion, totalRub
BOMRow          — строка BOM: ruleId, category, name, qty, price, sum
PriceItem       — прайс-позиция: lookupKey (unique), priceRub, supplier
PriceHistory    — история изменений цен (append-only)
AuditLog        — аудит всех действий (append-only)
```

---

## 8. Текущий статус

### Готово ✓
- Vue 3 проект с TypeScript, Pinia, Vue Router
- `src/types/calculator.ts` — все типы
- `src/data/nomenclature.ts` — справочник НН (~60 позиций)
- `src/engines/cost.ts` — расчётные функции + recalcAuto
- `src/stores/calculator.ts` — полный CRUD (строки/подгруппы/группы/связки)
- `src/components/calculator/CalcRow.vue` — строка с автокомплитом
- `src/views/CalculatorView.vue` — главная страница
- `src/assets/main.css` — dark theme, все компоненты
- Drag & Drop на всех 4 уровнях (только за иконку ⠿)
- Авто-пересчёт ФОТ при изменении qty

### В разработке / Следующие шаги
1. `LoginView.vue` — страница входа
2. Backend: Node.js + Express + Prisma + PostgreSQL
3. `DashboardView.vue` — список смет
4. `PricesView.vue` — реестр цен (отдел закупок)
5. Сохранение смет на сервере (API-интеграция)
6. `SurveyView.vue` — опросный лист (DN, PN, SN, глубина...)
7. Авто-генерация BOM из опросного листа
8. Экспорт в Excel (ExcelJS)
9. Docker Compose + деплой
