# Потоки данных и компоненты

> Актуализировано 2026-09-08 по фактическому коду.

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
│       └── survey/: SurveyShell, ToggleYesNo (CalcField — только у КНС)
├── CalculatorTreeView            /calculator/:id?  конфигуратор
│   ├── CalcTableRow              строка дерева (все состояния ячеек)
│   └── модал «История версий»    снапшоты + docx/pdf по каждой редакции
├── PurchaseRequestView           /calculator/:id/purchase
├── PricesView                    /prices
├── TemplatesView                 /templates  редактор шаблонов (TECHNOLOG):
│   ├── ProductTemplateEditor     шаблоны изделий: разделы, узлы, биндинги,
│   │                             предпросмотр, публикация
│   ├── NodeCatalogEditor         узлы каталога: параметры, строки, формулы
│   └── + вкладки справочников материализации (нормы, веса, Мс, матрицы)
└── AdminView                     /admin
ui/: BaseModal, HintLayer, ThemeToggle, ToastHost, UserMenu, ChangePasswordModal
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
   → «Версии» → docx | pdf         GET /estimates/:id/kp/export?format=…&version=N
                                     бэк: снапшот → buildKpDocument() →
                                     renderKpDocx | renderKpPdf → blob
   → «Экспорт»                     /calculator/:id/purchase → xlsx
```

## 3. Стор calcTree — единая точка расчёта экрана

```
load(id):
  параллельно: estimate, прайс (nomenclature), веса труб, инж. матрицы,
               активная версия прайса (/refs/price-version)
  → индексы: priceIdx (категория|имя|ЕИ), weightIdx (dn|pn|sn), normIdx (dn)
  → liveRates: 4 ставки действующего прайса (позиции нет — константа
    с отметкой fallback); дереву их ставит материализация (tree.rates)
  → totals: markup и tirage восстанавливаются из surveyData ДО первого
    recalcAll() — иначе переоткрытие молча возвращало 0,43 и 1 корпус
  → дерево: saved.tree (если ОЛ не менялся) | рематериализация | материализация

производные (computed):
  rows        — плоский список строк
  results     — Map<rowId, RowResult> = computeRow(row, {sectionEnabled, tirage})
  economics   — computeEconomics(aggregateRows(...), rates, {markup});
                rates — ставки дерева, у дерева без них — liveRates
                (до первого сохранения, План_устранения 1.3)
  economicsUnit — то же с tirage=1 (строка «за 1 корп.»)
  missingPriceIds / conflictIds / overrideIds — состояния строк

действия: setQtyManual/setPriceManual/resetQty/resetPrice,
  toggleSection/toggleComponent, keepOverride/dropOverride,
  addRow/removeRow (только isCustom), save(),
  clear() — сброс наценки/тиража/версии прайса: стор синглтон, иначе
    параметры предыдущего расчёта перетекали в следующий
```

Правило: компоненты НЕ считают строку — количество, цена и сумма приходят
из `engines/*`, стор держит состояние и вызывает движок.

Витринные подытоги — исключение: `CalculatorTreeView.vue:436` (`sumOf`)
складывает готовые `results[*].sum` по разделу (`sectionSum` :439) и
компоненту (`componentSum` :445), там же перевод рентабельности в проценты
(:353, :355); `PurchaseRequestView.vue:122` суммирует свои строки тем же
способом. Новых формул это не вводит — только сложение результатов движка.

## 4. Серверная сторона

Смету сервер не считает. `Estimate.surveyData` — единый JSON-документ
(ОЛ + дерево + totals). Точки контроля:

- `PATCH /estimates/:id/survey` — мёрж JSON под zod-схемой (`tree`,
  `surveyRev`/`treeSurveyRev`, `totals` типизированы, остальные ключи
  проходят passthrough: тело шлют четыре источника — стор калькулятора
  (`calcTree.save()`) и три экрана ОЛ), запись `totalRub` из
  `totals.salePriceRub`, DRAFT→CALC при первом сохранении, заморозка
  APPROVED/REJECTED
- `POST /estimates/:id/kp` — единственный гейт «нет строк без цены»
  (`rowsWithoutPrice`, estimate-tree.ts:91) + снапшот с версией прайса
- `PATCH /estimates/:id/status` — переходы сведены к DRAFT→CALC и →REJECTED;
  REVIEW/APPROVED безусловно отклоняются (422 `STATUS_FLOW_REMOVED`,
  estimates.routes.ts:128), гейта по строкам без цены здесь нет
- `DELETE /estimates/:id` — 422 `ESTIMATE_HAS_SNAPSHOTS`, если по расчёту
  есть снапшоты: связь `onDelete: Cascade` иначе молча стирала историю
  выпущенных КП
- `GET /estimates/:id/kp/export` — снапшот → `buildKpDocument()`
  (kp-document.ts:98, спецификация без цен строк + НДС «в том числе»)
  → `renderKpDocx` | `renderKpPdf`; чтение шире записи — VIEWER документ
  скачивает. Аудит: `estimate.kp.export`
- `GET /refs/price-version` — активная версия прайса `MAX(version)`; до неё
  фронт держал версию захардкоженной единицей, и топбар расходился со
  снапшотом

Подбор насосной станции — `POST /api/pump-station/*` (габарит НС, SN,
диаметр напорного, напорный узел, подбор насоса): чистые функции бэка плюс
каталог `Pump` в БД. Опросный лист КНС вызывает подбор насоса, диаметр
напорного и напорный узел (`composables/usePumpSelection.ts`); марка насоса
уходит в `surveyData.derived.pumpModel` и дальше в строку насоса расчёта.
