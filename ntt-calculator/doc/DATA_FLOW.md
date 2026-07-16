# Потоки данных и компоненты

## 1. Компонентное дерево (текущее)

```
App.vue
└── RouterView
    └── CalculatorView.vue
        ├── [sidebar]          — навигация по связкам/группам
        ├── [topbar]           — заголовок, итого, кнопки
        └── [calc-area]
            └── v-for bundles
                ├── [bnd-hd]   — drag-handle ⠿, название, итог, кнопки
                └── v-for groups
                    ├── [grp-hd]  — drag-handle ⠿, номер, название, итог
                    └── <table>
                        └── v-for subgroups
                            ├── [sg-hd-row]  — drag-handle ⠿, название подгруппы
                            └── v-for rows
                                └── CalcRow.vue  ← единственный выделенный компонент
```

## 2. Компонентное дерево (целевое)

```
App.vue
└── RouterView
    ├── LoginView.vue
    ├── DashboardView.vue       — список смет
    │   └── EstimateCard.vue    — карточка сметы (статус, сумма, дата)
    ├── CalculatorView.vue
    │   ├── AppSidebar.vue
    │   ├── AppTopbar.vue
    │   └── CalcBundle.vue      ← разбить из CalculatorView
    │       └── CalcGroup.vue   ← разбить из CalculatorView
    │           └── CalcSubgroup.vue  ← разбить из CalculatorView
    │               └── CalcRow.vue   ← уже готов
    ├── PricesView.vue          — реестр цен
    │   └── PriceRow.vue        — строка прайса
    └── AdminView.vue
```

---

## 3. Pinia Store — поток данных

```
CalculatorView.vue
    │
    ├── читает: store.bundles (reactive[])
    ├── читает: store.total (computed)
    ├── читает: store.bSum(b), store.gSum(g), store.sgSum(sg)
    │
    └── вызывает мутации:
        ├── store.addBundle()
        ├── store.addGroup(bid)
        ├── store.addSubgroup(gid)
        ├── store.addRowToSG(sgid, rtype)
        ├── store.moveBundleDrop(from, to)
        ├── store.moveRow(fromId, toId)
        ├── store.deleteRow(rid)
        └── ...

CalcRow.vue
    │
    ├── props: row (CalcRow), isDropTarget
    ├── emits: dragstart, dragover, dragleave, drop
    │
    └── вызывает напрямую:
        ├── store.setField(rid, field, value)
        ├── store.setQty(rid, value)      ← + recalcAuto()
        ├── store.overrideAuto(rid, value)
        ├── store.cycleRtype(rid)
        ├── store.cycleBuy(rid)
        ├── store.dupRow(rid)
        └── store.deleteRow(rid)
```

---

## 4. Авто-пересчёт ФОТ

```
Пользователь меняет qty строки МАТ "Механическое формованное дно"
    │
    ▼
store.setQty(rid, '300')
    │
    ▼
r.qty = '300'
recalcAuto(sg)  ← проходит все строки подгруппы
    │
    ▼
for r of sg.rows:
  if r.isAuto && r.autoParentId === 'id_дна':
    parent.qty = '300'
    r.qty = String(300 * 0.28)  → '84'   ← ФОТ обновлён автоматически
    │
    ▼
Vue реактивность замечает изменение r.qty
    │
    ▼
sum-cell в CalcRow.vue перерисовывается → '84 × 1207.8 = 101 455 ₽'
sgSum(sg) пересчитывается → обновляется итог подгруппы
gSum(g) → итог группы
bSum(b) → итог связки
store.total (computed) → итог в topbar
```

---

## 5. Drag & Drop — поток

```
Пользователь берёт ⠿ у строки
    │
    ▼
drag-handle @dragstart.stop → emit('dragstart', event, row.id)
    │
    ▼
CalculatorView: onRowDragStart(e, rid)
  dragData = { type: 'row', id: rid }
    │
    ▼
Пользователь тащит над другой строкой
    │
    ▼
другой <tr> @dragover.prevent → emit('dragover', row.id)
CalculatorView: onRowDragOver(rid)
  dropTarget.value = rid   ← CSS-класс drop-row применяется
    │
    ▼
Пользователь отпускает
    │
    ▼
@drop.prevent → emit('drop', row.id)
CalculatorView: onRowDrop(rid)
  store.moveRow(dragData.id, rid)
    │
    ▼
store.moveRow(fromRid, toRid):
  fromF.sg.rows.splice(fromIdx, 1)      ← удаляем из исходной позиции
  toF.sg.rows.splice(toIdx, 0, fromF.r) ← вставляем перед целевой строкой
    │
    ▼
Vue реактивность → таблица перерисовывается
```

---

## 6. Автокомплит наименования — поток

```
Пользователь кликает на поле "Наименование"
    │
    ▼
@focus → openDropdown()
  search = ''
  dropdownOpen = true
  catItems = NOM_DB[row.category]   ← фильтруем по выбранной категории
    │
    ▼
Отображается dropdown со всеми позициями категории
    │
    ▼
Пользователь вводит "ламин"
    │
    ▼
@input → search = 'ламин'
filtered = catItems.filter(x => x.n.toLowerCase().includes('ламин'))
→ [ "Ламинирование дна к фальшполу", "Ламинирование патрубка...", ... ]
    │
    ▼
Пользователь нажимает ↓↓ и Enter
    │
    ▼
selectItem(item):
  store.setField(rid, 'name',  item.n)    → "Ламинирование дна к фальшполу"
  store.setField(rid, 'unit',  item.u)    → "кг"
  store.setField(rid, 'price', item.p)    → "310.2"
  store.setField(rid, 'note',  item.note) → ""
  dropdownOpen = false
```

---

## 7. CSS-переменные (design tokens)

```css
/* Фоны (тёмная тема) */
--bg:  #0b0e18   /* самый тёмный — основной фон страницы */
--bg2: #10141f   /* сайдбар, topbar, карточки bundle */
--bg3: #161c2e   /* заголовки bundle */
--bg4: #1b2236   /* заголовки group, ячейки select */
--bg5: #202840   /* thead, badge фоны */

/* Бордеры */
--bd:  #1e2840
--bd2: #283258
--bd3: #354068

/* Текст */
--tx:  #d0d8f0   /* основной */
--tx2: #6070a0   /* второстепенный */
--tx3: #364060   /* подписи, плейсхолдеры */
--tx4: #1c2540   /* очень приглушённый */

/* Акценты */
--am:  #eeaa28   /* янтарный — итоги, акцент, МАТ */
--tl:  #16c8b0   /* бирюзовый — авто-строки, подгруппы, РАБ */
--pp:  #9068f8   /* фиолетовый — ФОТ */
--gn:  #30d468   /* зелёный — ЗАК, закупка */
--rd:  #ee6868   /* красный — удаление */
```
