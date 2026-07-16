# Типы и интерфейсы — быстрая справка

## calculator.ts

```typescript
// Тип строки в таблице
type RowType  = 'МАТ' | 'РАБ' | 'ФОТ' | 'ЗАК'
type BuyState = 'нет' | 'да' | '-'

// Строка таблицы
interface CalcRow {
  id            string
  rtype         RowType
  category      string         // из ALL_CATS
  name          string         // из NOM_DB[category]
  purchase      BuyState
  qty           string         // строка — для дробей
  unit          string         // из UNITS
  price         string
  note          string
  isAuto        boolean        // ФОТ авто-пересчёт
  autoParentId  string | null  // id родительской строки
  autoCoeff     number | null  // qty = parent.qty × coeff
}

// Подгруппа (операция: труба, дно, ламинация...)
interface CalcSubgroup {
  id        string
  title     string
  collapsed boolean
  rows      CalcRow[]
}

// Группа (секция таблицы)
interface CalcGroup {
  id         string
  title      string
  collapsed  boolean
  subgroups  CalcSubgroup[]
}

// Связка (цветная карточка)
interface CalcBundle {
  id        string
  title     string
  color     string    // hex из BCOLORS
  collapsed boolean
  groups    CalcGroup[]
}

// Позиция справочника
interface NomItem {
  n     string   // наименование
  u     string   // единица измерения
  p     string   // цена (пустая если не задана)
  note  string   // примечание
}
```

---

## nomenclature.ts — константы

```typescript
FOT_RATE = '1207.8'        // руб/чел·ч

BCOLORS = [                // цвета связок
  '#eeaa28',  // янтарный
  '#16c8b0',  // бирюзовый
  '#9068f8',  // фиолетовый
  '#ee6868',  // красный
  '#30d468',  // зелёный
  '#3a9aff',  // синий
  '#f07028',  // оранжевый
  '#e058c0',  // розовый
]

RTYPE_ORDER = ['МАТ', 'РАБ', 'ФОТ', 'ЗАК']  // порядок цикла

RTYPE_CLASS = {            // CSS-классы бейджей
  МАТ: 'rt-M',
  РАБ: 'rt-W',
  ФОТ: 'rt-F',
  ЗАК: 'rt-P',
}

RTYPE_COLOR = {            // CSS-переменные цветов
  МАТ: 'var(--am)',
  РАБ: 'var(--tl)',
  ФОТ: 'var(--pp)',
  ЗАК: 'var(--gn)',
}

BUY_CYCLE = ['нет', 'да', '-']

UNITS = ['м','м²','м³','шт','кг','т','ч·ч','уп.','компл.']

NOM_DB: Record<string, NomItem[]>  // справочник номенклатуры НН

ALL_CATS = Object.keys(NOM_DB)     // список всех категорий
```

---

## cost.ts — функции

```typescript
// Сумма одной строки
rowSum(r: CalcRow): number
  → (parseFloat(r.qty) || 0) × (parseFloat(r.price) || 0)

// Сумма подгруппы
sgSum(sg: CalcSubgroup): number
  → sg.rows.reduce((s, r) => s + rowSum(r), 0)

// Сумма группы
gSum(g: CalcGroup): number
  → g.subgroups.reduce((s, sg) => s + sgSum(sg), 0)

// Сумма связки
bSum(b: CalcBundle): number
  → b.groups.reduce((s, g) => s + gSum(g), 0)

// Общий итог
grandTotal(bundles: CalcBundle[]): number
  → bundles.reduce((s, b) => s + bSum(b), 0)

// Форматирование числа
fmt(n: number): string
  → n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

// ФОТ-коэффициент по названию операции
fotCoeff(name: string): number
  → 'мех'|'формов' → 0.28
  → 'ламин'        → 0.56
  → иначе          → 1.00

// Пересчёт авто-строк в подгруппе
recalcAuto(sg: CalcSubgroup): void
  → для каждой r где r.isAuto:
       r.qty = parent.qty × r.autoCoeff
```

---

## calculator.ts (store) — методы

```typescript
// Фinders
findBundle(id)   → CalcBundle | undefined
findGroup(id)    → { b, g } | null
findSG(id)       → { b, g, sg } | null
findRow(id)      → { b, g, sg, r } | null

// Строки
setField(rid, field, value)    // изменить поле + recalcAuto
setQty(rid, value)             // изменить qty + recalcAuto
overrideAuto(rid, value)       // ручной ввод авто-строки
cycleRtype(rid)                // МАТ→РАБ→ФОТ→ЗАК→МАТ
cycleBuy(rid)                  // нет→да→-→нет
addRowToSG(sgid, rtype?)       // добавить строку (перед ФОТ)
dupRow(rid)                    // дублировать
deleteRow(rid)                 // удалить
moveRow(fromId, toId)          // drag&drop строк

// Подгруппы
addSubgroup(gid, afterId?)     // добавить (с MAT + FOT)
dupSubgroup(sgid)              // дублировать (с ремаппингом autoParentId)
deleteSubgroup(sgid)
moveSG(gid, sgid, dir)         // сдвиг на ±1
moveSGToGroup(sgid, toGid, beforeSGid?)  // drag между группами

// Группы
addGroup(bid)
dupGroup(bid, gid)
deleteGroup(bid, gid)
moveGroup(bid, gid, dir)

// Связки
addBundle()
deleteBundle(bid)
moveBundle(bid, dir)           // сдвиг на ±1
moveBundleDrop(fromId, toId)   // drag&drop

// UI
collapseAll()
expandAll()
exportTxt()
```

---

## CalcRow.vue — props / emits

```typescript
// Props
row: CalcRow
isDropTarget?: boolean   // CSS-класс drop-row

// Emits (для drag&drop в родителе)
dragstart: [e: DragEvent, id: string]
dragover:  [id: string]
dragleave: []
drop:      [id: string]

// Внутренние refs
nameInputRef: HTMLInputElement    // ref на поле ввода имени
dropdownOpen: boolean             // показать dropdown
search: string                    // текст поиска в dropdown
activeIdx: number                 // активный элемент (клавиши ↑↓)
```
