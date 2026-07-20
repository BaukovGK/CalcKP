# Потоки данных и компоненты

> Актуализировано 2026-07-20 по фактическому коду.

## 1. Компонентное дерево (живое)

```
App.vue → RouterView
├── LoginView
├── DashboardView                 /            список проектов
│   └── ProjectCard
├── ProjectView                   /projects/:id
│   └── (карточки единиц — инлайн; «＋ Добавить единицу» → /survey?project=…)
├── SurveyView                    /survey/:id?  ЕДИНЫЙ ОЛ, ветвление по типу
│   ├── SurveyKnsView             ветка КНС (собственный каркас .ol)
│   ├── SurveyEmkView             ветка ЕМК ┐
│   └── SurveyKolView             ветка КОЛ ┴ оба на SurveyShell
│       └── survey/: SurveyShell, ToggleYesNo, CalcField
├── CalculatorTreeView            /calculator/:id   конфигуратор
│   └── CalcTableRow              строка дерева (все состояния ячеек)
├── PurchaseRequestView           /calculator/:id/purchase
├── PricesView                    /prices
└── AdminView                     /admin
ui/: BaseModal, ContextMenu, ThemeToggle, ToastHost
```

## 2. Сквозной поток данных

```
ProjectView «＋ Добавить единицу»
   → /survey?project=<id>          SurveyView: выбор типа, ветка формы
   → «Создать расчёт»              POST /projects/:id/estimates
                                   surveyData = { common, kns|emk|kol, form,
                                                  derived?, sections, surveyRev:1 }
   → /calculator/:id               calcTree.load():
                                     нет tree → materializeByDevice() → дерево
   → правки инженера               qtyManual/priceManual/тумблеры (в памяти)
   → «Сохранить»                   PATCH /estimates/:id/survey
                                   { tree, treeSurveyRev, totals } → totalRub
   ⇄ «← Опросный лист»             /survey/:id — форма из surveyData.form,
   → «Сохранить ОЛ»                surveyRev++ → PATCH survey
   → /calculator/:id               load(): surveyRev > treeSurveyRev
                                     → рематериализация + reconcileTrees()
                                     → конфликты «было → стало»
   → «Сформировать КП»             POST /estimates/:id/kp
                                     бэк: rowsWithoutPrice() гейт → снапшот
   → «Экспорт»                     /calculator/:id/purchase → xlsx
```

## 3. Стор calcTree — единая точка расчёта экрана

```
load(id):
  параллельно: estimate, прайс (nomenclature), веса труб, инж. матрицы
  → индексы: priceIdx (категория|имя|ЕИ), weightIdx (dn|pn|sn), normIdx (dn)
  → rates: 4 ставки из прайса (fallback — константы)
  → дерево: saved.tree (если ОЛ не менялся) | рематериализация | материализация

производные (computed):
  rows        — плоский список строк
  results     — Map<rowId, RowResult> = computeRow(row, {sectionEnabled, tirage})
  economics   — computeEconomics(aggregateRows(...), rates, {markup})
  economicsUnit — то же с tirage=1 (строка «за 1 корп.»)
  missingPriceIds / conflictIds / overrideIds — состояния строк

действия: setQtyManual/setPriceManual/resetQty/resetPrice,
  toggleSection/toggleComponent, keepOverride/dropOverride,
  addRow/removeRow (только isCustom), save()
```

Правило: компоненты НЕ считают ничего сами — вся арифметика в `engines/*`,
стор только держит состояние и вызывает движок.

## 4. Серверная сторона

Сервер расчёт не выполняет. `Estimate.surveyData` — единый JSON-документ
(ОЛ + дерево + totals). Точки контроля:

- `PATCH /estimates/:id/survey` — мёрж JSON, запись `totalRub` из totals,
  DRAFT→CALC при первом сохранении, заморозка APPROVED/REJECTED
- `PATCH /estimates/:id/status` — таблица переходов по ролям;
  CALC→REVIEW блокируется строками без цены (estimate-tree.ts)
- `POST /estimates/:id/kp` — тот же гейт + снапшот с версией прайса
