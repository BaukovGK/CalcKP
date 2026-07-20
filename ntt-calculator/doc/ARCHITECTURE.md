# НТТ Калькулятор — Архитектура системы

> Актуализировано 2026-07-20 по фактическому коду. Прежняя редакция описывала
> раннюю задумку (серверные движки BOM, свободное дерево связок) — реализация
> ушла на другую модель, см. §4 и §6.

## 1. Обзор

Веб-приложение для расчёта себестоимости стеклокомпозитного ёмкостного
оборудования.

**Типы изделий:** КНС (KNS), Ёмкость (EMK), Колодец (KOL)
**Материал:** стеклокомпозит (СК/НПС) — расчёты через нормо-часы и кг ламинации

**Рабочие пространства:**
- Коммерческий/технический отдел — проекты, опросные листы, расчёты, КП
- Отдел закупок — прайс-лист (импорт xlsx), заявки на закупку
- Админ — пользователи, аудит

## 2. Технологический стек

| Слой | Технологии |
|---|---|
| Frontend | Vue 3.5 (Composition API), TypeScript, Vite, Pinia, Vue Router, Axios, Vitest |
| Backend | Node.js 20, Express 4, TypeScript, Prisma ORM, Zod, JWT |
| БД | PostgreSQL 16 (docker compose), справочники в таблицах |
| Развёртывание | Docker Compose (`docker-compose.yml` в корне), проверка — `verify.ps1` |

## 3. Структура репозитория

```
сметы/
├── ntt-calculator/              Vue 3 фронтенд
│   └── src/
│       ├── api/                 HTTP-клиенты: client, estimates, projects,
│       │                        prices, refs, admin
│       ├── composables/         useKnsSurvey, useEmkKolSurvey, useTheme, useToast
│       ├── engines/             ЧИСТАЯ расчётная библиотека (покрыта тестами):
│       │   ├── row.ts           расчёт строки (qty/price/sum, overrides)
│       │   ├── economics.ts     экономический хвост (корзины, ПЗР/СИЗ/ацетон,
│       │   │                    наценка, цена продажи)
│       │   ├── fot.ts           ФОТ-спутники (k = 0,28 / 0,56 / 1,0)
│       │   ├── expr.ts          арифметика в полях («1,55*2+2,88*2»)
│       │   ├── rounding.ts      ROUNDUP-семейство эталона
│       │   ├── format.ts        форматирование чисел
│       │   ├── survey-kns.ts    формулы ОЛ КНС (Нподз, SN по глубине…)
│       │   ├── survey-emk-kol.ts формулы ОЛ ЕМК/КОЛ (геометрия, длина из объёма)
│       │   ├── template-kns.ts  материализация дерева КНС (7 разделов)
│       │   └── template-emk-kol.ts материализация ЕМК (8) и КОЛ (7);
│       │                        общие узлы переиспользуются из template-kns
│       ├── stores/              Pinia: auth, projects, estimates, prices,
│       │   └── calcTree.ts      ГЛАВНЫЙ стор: загрузка расчёта, материализация,
│       │                        рематериализация при изменении ОЛ, overrides,
│       │                        конфликты, экономика, сохранение
│       ├── types/               survey.ts (SurveyCommonForm, KnsSurveyForm),
│       │                        survey-emk-kol.ts (Emk/KolSurveyForm), ui.ts
│       └── views/
│           ├── LoginView, DashboardView (проекты), ProjectView
│           ├── SurveyView       ЕДИНЫЙ опросный лист /survey/:id? —
│           │                    ветвление по типу изделия; ветки:
│           ├── SurveyKnsView / SurveyEmkView / SurveyKolView
│           ├── CalculatorTreeView конфигуратор расчёта /calculator/:id
│           ├── PurchaseRequestView заявка на закупку /calculator/:id/purchase
│           ├── PricesView       реестр цен + импорт xlsx
│           └── AdminView        пользователи, аудит
│
├── backend/
│   ├── src/
│   │   ├── app.ts               Express, монтирование роутеров
│   │   ├── middleware/          auth (JWT), rbac, validate (Zod), errorHandler
│   │   ├── routes/              auth, estimates, projects, prices, purchase,
│   │   │                        refs, admin
│   │   └── utils/               prisma, jwt, audit, logger, nn-sheet (импорт
│   │                            прайса), estimate-tree (обход дерева для гейтов)
│   └── prisma/
│       ├── schema.prisma        схема БД
│       ├── seed.ts + seed-data/ сид: пользователи, прайс (1043 позиции),
│       │                        веса труб, инженерные матрицы, нормы патрубков
│       └── migrations/
│
├── doc/ (в корне)               ТЗ, Механика_калькулятора, Библиотека, Реверс
└── docker-compose.yml
```

## 4. Где считается расчёт (ключевое решение)

**Вся расчётная математика — на клиенте** (`ntt-calculator/src/engines/*`).
Сервер расчёт НЕ выполняет: он хранит `surveyData` (JSON) и валидирует
инварианты на гейтах (строки без цены блокируют выпуск КП и переход
CALC→REVIEW — `backend/src/utils/estimate-tree.ts`).

Обоснование: формулы итеративно сверяются с эталонными Excel; один движок
на TypeScript с юнит-тестами (263 шт.) проще держать верным, чем два.
Плата — итог (`totalRub`) приходит с клиента и фиксируется на сервере при
сохранении; целостность обеспечивают снапшоты и аудит.

## 5. Модель данных расчёта

### Единый контракт `Estimate.surveyData` (JSON)

```
{
  common:   { zayavka, stadiya, zakazchik, obekt, region, data }  // общий блок ОЛ
  kns|emk|kol: {…}          // параметры материализации своего типа
  form:     {…}             // полная форма ОЛ — для повторного открытия
  derived:  {…}             // производные ОЛ (Нподз, SN, PN…) — только КНС
  surveyRev: number         // ревизия ОЛ, растёт при каждом сохранении ОЛ
  tree:     CalcTree        // материализованное дерево (пишет конфигуратор)
  treeSurveyRev: number     // ревизия ОЛ, из которой построено дерево
  totals:   { costRub, salePriceRub, markup, tirage }
  sections: […]             // каркас разделов (создание)
}
```

### Дерево расчёта (CalcTree)

```
CalcTree
  └── CalcSection[]        раздел («сборка»): code, title, enabled
        └── CalcComponent[] компонент: title, enabled; id «custom-<код>» —
              │             строки, добавленные вручную (только их можно удалять)
              └── CalcRowNode[] строка: kind МАТЕРИАЛ|ОПЕРАЦИЯ|ФОТ,
                            qtyCalc/qtyManual (выражение), priceCatalog/priceManual,
                            parentId+fotK у ФОТ-спутников
```

Разделы: КНС — 7, ЕМК — 8 (+корзина, шахта; напорный только при насосах),
КОЛ — 7 (без напорного, + горловина). Раздел «Оборудование» у ЕМК/КОЛ
материализуется пустым — состав вариативен, строки добавляются вручную.

### Рематериализация (Механика §8.3)

Правка ОЛ существующего расчёта (`/survey/:id`) поднимает `surveyRev`.
При `surveyRev > treeSurveyRev` конфигуратор строит свежее дерево и переносит
в него ручные правки (`stores/calcTree.ts → reconcileTrees`): overrides
количеств и цен, тумблеры разделов/компонентов, «Добавлено вручную» — целиком.
Сопоставление строк — по стабильному ключу «вид+наименование+ЕИ» (id строк
нестабильны между материализациями). Строка, где override лёг на изменившееся
расчётное, получает конфликт «было → стало» с действиями
[Оставить моё] / [Принять новое].

### Экономика

Пять корзин (Материалы на закупку / Труба, муфта / Формовка / Работы, ФОТ /
Прочие) → себестоимость → наценка (0,43 по умолчанию) → цена продажи
ROUNDUP до 100 ₽ → рентабельность. ПЗР входит в «Работы, ФОТ»; «Прочие» =
ацетон + СИЗ + накладные. Ставки (ФОТ 1207,8; накладные 1584,73; ацетон
109,4; СИЗ 122) — позиции прайса, константы кода — только fallback.
Тираж ≥2: главные цифры за весь тираж, «за 1 корп.» — отдельный прогон
экономики с tirage=1 (округления нелинейны).

## 6. Жизненный цикл расчёта

```
проект → единый ОЛ (/survey?project=…) → расчёт (projectId) →
конфигуратор (/calculator/:id) ⇄ правка ОЛ (/survey/:id) →
[Сформировать КП] → гейт «нет строк без цены» (бэк) → снапшот
```

Статусы: DRAFT → CALC (первое сохранение) → REVIEW → APPROVED (снапшот,
заморозка) / REJECTED. Переходы валидируются на бэке (`PATCH /:id/status`);
точка фиксации реального процесса — выпуск КП, а не согласование
(Механика §10, ред. 2026-07-16).

## 7. Роли и доступ

| Действие | manager | engineer | buyer | viewer | admin |
|---|:---:|:---:|:---:|:---:|:---:|
| Проекты, ОЛ, расчёты (создание/правка) | ✓ | ✓ | — | — | ✓ |
| Просмотр чужих расчётов, CALC→REVIEW→APPROVED | ✓ | — | — | — | ✓ |
| Прайс: правка, импорт xlsx | — | — | ✓ | — | ✓ |
| Заявка на закупку (просмотр/выгрузка) | ✓ | ✓ | ✓ | — | ✓ |
| Пользователи, аудит | — | — | — | — | ✓ |

В схеме БД есть также роль `TECHNOLOG` (редактор каталога/шаблонов) — на
фронте пока не используется, зарезервирована под редактор шаблонов.

## 8. API

```
POST   /api/auth/login | /refresh     GET /api/auth/me     DELETE /api/auth/logout

GET|POST /api/projects                GET|PATCH|DELETE /api/projects/:id
POST   /api/projects/:id/estimates    создать расчёт в проекте

GET|POST /api/estimates               GET|DELETE /api/estimates/:id
PATCH  /api/estimates/:id/survey      мёрж surveyData + запись totalRub из totals
PATCH  /api/estimates/:id/status      таблица переходов + гейт красных строк
POST   /api/estimates/:id/snapshot    ручное версионирование
POST   /api/estimates/:id/kp          выпуск КП: гейт + снапшот
GET    /api/estimates/:id/kp/export   501 — ждём образец документа
GET    /api/estimates/:id/snapshots   история версий
POST   /api/estimates/:id/purchase-request/export   заявка на закупку (xlsx)

GET    /api/prices                    PATCH /api/prices/:id
POST   /api/prices/import             импорт xlsx (лист НН)

GET    /api/refs/nomenclature | /pipe-weights | /engineering

GET    /api/admin/users               POST/PATCH пользователи
GET    /api/admin/audit               GET /api/health
```

## 9. Схема БД (Prisma)

```
User             роли: ADMIN MANAGER ENGINEER TECHNOLOG BUYER VIEWER
Project          проект: title, customer, address; 1→N Estimate
Estimate         deviceType KNS|EMK|KOL, status, surveyData Json (ОЛ + дерево),
                 totalRub (дублирует итог для списков), projectId?
EstimateSnapshot version, priceListVersion, totalRub, bundlesJson (append-only)
PriceItem        @@unique(category, name, unit); priceBaseRub, discountPct,
                 priceRub; включает ставки экономблока (ФОТ, накладные,
                 ацетон, СИЗ)
PriceListVersion версия прайса целиком
PriceHistory     история изменений цен (append-only)
PipeWeight       веса труб GRP: (dn, pn, sn) → кг/м
PePipe           веса ПЭ-труб
EngineeringMatrix матрица «Для расчетов» (enum MatrixKind)
NozzleNorm       нормы патрубков: DN → масса формовки гильзы
AuditLog         аудит действий (append-only)
```

## 10. Текущий статус

### Готово
- Полный поток: проекты → единый ОЛ (ветвление КНС/ЕМК/КОЛ, создание и
  редактирование) → материализация → конфигуратор (overrides, конфликты,
  каталог, экономика, тираж) → КП (гейт+снапшот) → заявка на закупку (xlsx)
- Рематериализация при изменении ОЛ с переносом правок и конфликтами
- Backend: авторизация JWT, RBAC, все роутеры, аудит, сид справочников
- Docker Compose, verify.ps1; движки покрыты юнит-тестами (263)

### Не сделано / отложено
- Печатная форма КП (501 — ждём образец от заказчика)
- Экран истории снапшотов (бэк готов, UI нет)
- Редактор шаблонов для роли TECHNOLOG
- Массы днищ/шахты ЕМК — ручной ввод (нет матрицы масс от завода)
