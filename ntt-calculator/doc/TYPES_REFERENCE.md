# Типы — где что лежит

> Актуализировано 2026-09-08. Прежняя редакция дублировала определения
> legacy-типов (`types/calculator.ts` — удалён). Определения НЕ копируются
> сюда: источник истины — исходники, здесь карта и семантика.

## Опросный лист — `src/types/`

| Тип | Файл | Семантика |
|---|---|---|
| `SurveyCommonForm` | `survey.ts` | Общий блок всех трёх ОЛ: заявка, стадия, заказчик, объект, регион, дата. `pickCommon()` выделяет его для записи в `surveyData.common` |
| `KnsSurveyForm` | `survey.ts` | Полная форма ОЛ КНС (extends common). Хранится в `surveyData.kns` и `surveyData.form` |
| `EmkSurveyForm`, `KolSurveyForm` | `survey-emk-kol.ts` | Формы ЕМК/КОЛ (extends common). Хранятся в `surveyData.form` |
| `KnsSurveyParams`, `EmkSurveyParams`, `KolSurveyParams` | `engines/template-*.ts` | Числовые параметры материализации — то, что реально ест шаблон. Хранятся в `surveyData.kns` \| `.emk` \| `.kol` (у КНС выводятся из формы + derived) |

## Дерево расчёта — `src/engines/template-kns.ts`

| Тип | Семантика |
|---|---|
| `CalcTree` | Корень: `deviceType`, `survey` (параметры ОЛ на момент материализации — расчёт самодостаточен), `priceListVersion`, `sections[]` |
| `CalcSection` | Раздел («сборка»): `code`, `title`, `enabled` |
| `CalcComponent` | Компонент: `title`, `enabled`, `rows[]`; id `custom-<код>` — ручные строки (только их можно удалять) |
| `CalcRowNode` | Строка (extends `EngineRow`): добавляет `isCustom` (добавлена инженером — только такие удаляются) и `bucket` (явная корзина итогов, когда по ЕИ неотличима). id нестабилен между материализациями — сопоставление по «вид+имя+ЕИ» (`calcTree.reconcileTrees`) |
| `MaterializeContext` | Инъекция справочников в шаблон: `priceOf`, `pipeWeightOf`, `nozzleNormOf` + `priceListVersion` (уезжает в `CalcTree`) |

## Движок — `src/engines/types.ts`

| Тип | Семантика |
|---|---|
| `RowKind` | `МАТЕРИАЛ` \| `ОПЕРАЦИЯ` \| `ФОТ` |
| `EngineRow` | Вход расчёта строки: `qtyCalc`/`qtyManual` (выражение), `priceCatalog`/`priceManual`, `parentId`+`fotK` у ФОТ-спутников, `enabled`, `note`. `isCustom` сюда НЕ входит — он в `CalcRowNode` |
| `RowResult` | Выход `computeRow`: `qty`, `price`, `sum`, `qtyOverridden`, `priceOverridden`, `missingPrice` |
| `Category`, `CATEGORIES` | 16 категорий строки (лист «Списки», AG2:AG17); порядок значим |
| `NON_PURCHASE_CATEGORIES` | Три непокупные категории («Собственное производство», «Работы», «ФОТ») — «Закупка = нет» |
| `UNIT_HOURS`, `UNIT_MASS` | «чел. ч» / «кг» — ЕИ определяет корзину себестоимости |

## Экономика — `src/engines/economics.ts`

| Тип | Семантика |
|---|---|
| `CostBucket`, `COST_BUCKETS` | 5 корзин себестоимости |
| `Rates` | 4 ставки (ФОТ, накладные, ацетон, СИЗ) — из прайса |
| `RowAggregate` | Агрегаты по строкам — вход `computeEconomics` |
| `Economics` | Полный итоговый блок (корзины, ПЗР/СИЗ/ацетон/накладные, себестоимость, цена, рентабельность) |

## API — `src/api/`

| Тип | Файл | Семантика |
|---|---|---|
| `DeviceType` | `types/device.ts` | `KNS` \| `EMK` \| `KOL` — единственное определение на фронте; `api/estimates.ts` и `engines/template-kns.ts` его РЕЭКСПОРТИРУЮТ. Enum в `schema.prisma` — граница TS/Prisma, не дубль |
| `EstimateStatus` | `estimates.ts` | `DRAFT → CALC` / `REJECTED`; `REVIEW`, `APPROVED` остались в типе ради старых расчётов — новые переходы бэк отклоняет (`STATUS_FLOW_REMOVED`) |
| `EstimateListItem`, `EstimateDetail` | `estimates.ts` | Ответы списка/карточки расчёта |
| `EstimateSnapshotInfo`, `KpResult` | `estimates.ts` | Версия из истории и ответ выпуска КП; печатная форма — `kpExport()`, возвращает `Blob` |
| `ProjectListItem`, `ProjectDetail`, `ProjectEstimate` | `projects.ts` | Проект и его единицы |
| `Nomenclature`, `EngineeringRefs`, `PipeWeightGrp`, `PePipe` | `refs.ts` | Справочники, которыми `calcTree.load()` кормит материализацию |
| `PriceVersionInfo` | `refs.ts` | Активная версия прайса (`GET /refs/price-version`) — то, что показывает топбар |
| `MatrixKind`, `NozzleNormDto`, `PipeWeightDto`, `MatrixCellDto` | `templates.ts` | Тела записи в справочники из редактора шаблонов |

## Бэкенд — печатная форма и подбор НС (`backend/src/utils/`)

Общего пакета у фронта и бэка нет, поэтому эти типы живут отдельно и на
фронте не используются.

| Тип | Файл | Семантика |
|---|---|---|
| `TreeRow` | `estimate-tree.ts` | Строка дерева в форме, доступной серверу: обход понимает и `tree.sections`, и legacy-`bundles` |
| `SpecRow`, `SpecSection` | `estimate-tree.ts` | Спецификация для КП: «наименование · ЕИ · количество» по разделам. Цены сюда не попадают намеренно |
| `KpDocument`, `KpDocumentInput` | `kp-document.ts` | Модель печатной формы: реквизиты, спецификация, итог, `vatRub` — НДС, ВЫДЕЛЕННЫЙ из суммы (`VAT_RATE_PCT`), а не начисленный сверху. Рендеры `kp-docx.ts`/`kp-pdf.ts` про Prisma и HTTP не знают |
| `PumpStationInput`, `PumpStationDimensions` | `pump-station-dimensions.ts` | Габарит НС: диаметр корпуса (задан или подобран из типоряда), Нподз, рабочая зона; `ringStiffnessPa` — сквозной параметр, функция его не считает |
| `PipeDiameterResult` | `pipe-hydraulics.ts` | Диаметр напорного трубопровода: каталожный и теоретический, фактическая скорость, расход на один насос |
| `PumpCatalogEntry`, `PumpSelectionResult` | `pump-selection.ts` | Позиция каталога (зеркало модели `Pump` в БД) и результат подбора по рабочей точке ОДНОГО насоса |

У всех трёх результатов подбора есть `warnings: { code, message }[]` — выход
за производственный диапазон, отсутствие подходящей модели, скорость вне
рекомендуемой. Исключение бросается только на невалидный ВХОД (расход ≤ 0
и т. п.); подбор, который «не сошёлся», возвращается результатом
с предупреждением, а не ошибкой.

## Контракт `surveyData` (JSON в `Estimate.surveyData`)

См. `ARCHITECTURE.md` §5 — единственное место, где он описан целиком:
`common · kns|emk|kol · form · derived · surveyRev · tree · treeSurveyRev ·
totals · sections`.
