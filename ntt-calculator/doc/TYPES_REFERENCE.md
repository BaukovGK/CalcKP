# Типы — где что лежит

> Актуализировано 2026-07-20. Прежняя редакция дублировала определения
> legacy-типов (`types/calculator.ts` — удалён). Определения НЕ копируются
> сюда: источник истины — исходники, здесь карта и семантика.

## Опросный лист — `src/types/`

| Тип | Файл | Семантика |
|---|---|---|
| `SurveyCommonForm` | `survey.ts` | Общий блок всех трёх ОЛ: заявка, стадия, заказчик, объект, регион, дата. `pickCommon()` выделяет его для записи в `surveyData.common` |
| `KnsSurveyForm` | `survey.ts` | Полная форма ОЛ КНС (extends common). Хранится в `surveyData.kns` и `surveyData.form` |
| `EmkSurveyForm`, `KolSurveyForm` | `survey-emk-kol.ts` | Формы ЕМК/КОЛ (extends common). Хранятся в `surveyData.form` |
| `KnsSurveyParams`, `EmkSurveyParams`, `KolSurveyParams` | `engines/template-*.ts` | Числовые параметры материализации — то, что реально ест шаблон. Хранятся в `surveyData.kns|emk|kol` (у КНС выводятся из формы + derived) |

## Дерево расчёта — `src/engines/template-kns.ts`

| Тип | Семантика |
|---|---|
| `CalcTree` | Корень: `sections[]` + `priceListVersion` |
| `CalcSection` | Раздел («сборка»): `code`, `title`, `enabled` |
| `CalcComponent` | Компонент: `title`, `enabled`, `rows[]`; id `custom-<код>` — ручные строки (только их можно удалять) |
| `CalcRowNode` | Строка (extends `EngineRow`): id нестабилен между материализациями — сопоставление по «вид+имя+ЕИ» (`calcTree.reconcileTrees`) |
| `MaterializeContext` | Инъекция справочников в шаблон: `priceOf`, `pipeWeightOf`, `nozzleNormOf` |

## Движок — `src/engines/types.ts`

| Тип | Семантика |
|---|---|
| `RowKind` | `МАТЕРИАЛ` \| `ОПЕРАЦИЯ` \| `ФОТ` |
| `EngineRow` | Вход расчёта строки: `qtyCalc`/`qtyManual` (выражение), `priceCatalog`/`priceManual`, `parentId`+`fotK` у ФОТ-спутников, `enabled`, `isCustom` |
| `RowResult` | Выход `computeRow`: `qty`, `price`, `sum`, `qtyOverridden`, `priceOverridden`, `missingPrice` |
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
| `DeviceType` | `estimates.ts` | `KNS` \| `EMK` \| `KOL` (дублируется в template-kns и schema.prisma — тех. долг) |
| `EstimateStatus` | `estimates.ts` | `DRAFT → CALC → REVIEW → APPROVED` / `REJECTED` |
| `EstimateListItem`, `EstimateDetail` | `estimates.ts` | Ответы списка/карточки расчёта |
| `ProjectListItem`, `ProjectDetail`, `ProjectEstimate` | `projects.ts` | Проект и его единицы |

## Контракт `surveyData` (JSON в `Estimate.surveyData`)

См. `ARCHITECTURE.md` §5 — единственное место, где он описан целиком:
`common · kns|emk|kol · form · derived · surveyRev · tree · treeSurveyRev ·
totals · sections`.
