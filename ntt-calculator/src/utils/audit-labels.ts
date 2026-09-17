/**
 * Журнал действий по-русски: названия событий, разделы и подробности.
 *
 * В базе событие лежит кодом («estimate.kp.export»), а объект — типом и
 * идентификатором («Estimate:1853b9c0…»). Администратору это читать нельзя:
 * экран показывал таблицу кодов, по которой не понять ни что произошло, ни с
 * чем. Здесь коды превращаются в человеческие названия, а `meta` — в
 * подписи вида «номер КП: КП-0042».
 *
 * Словарь неполный по устройству: событие, которого здесь нет, показывается
 * своим кодом. Так новое событие на сервере не ломает экран и сразу видно,
 * что ему нужна подпись.
 *
 * @module utils/audit-labels
 */

/** Разделы журнала — они же выбор в отборе «Раздел». */
export const AUDIT_GROUPS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'auth', label: 'Вход и сеансы' },
  { key: 'estimate', label: 'Расчёты и КП' },
  { key: 'project', label: 'Проекты' },
  { key: 'prices', label: 'Прайс' },
  { key: 'purchase', label: 'Заявки на закупку' },
  { key: 'user', label: 'Сотрудники' },
  { key: 'template', label: 'Шаблоны и справочники' },
  { key: 'db', label: 'База данных' },
]

/** Названия событий. Ключ — код действия из `backend/utils/audit.ts`. */
export const AUDIT_LABELS: Readonly<Record<string, string>> = {
  'auth.login': 'Вход в систему',
  'auth.login_failed': 'Неудачный вход',
  'auth.logout': 'Выход',

  'estimate.create': 'Создан расчёт',
  'estimate.delete': 'Удалён расчёт',
  'estimate.status_change': 'Смена статуса расчёта',
  'estimate.snapshot': 'Зафиксирована версия',
  'estimate.kp': 'Выпущено КП',
  'estimate.kp.export': 'Выгружено КП',

  'project.create': 'Создан проект',
  'project.update': 'Изменён проект',
  'project.delete': 'Удалён проект',
  'project.kp.export': 'Выгружено КП на проект',

  'purchase.export': 'Выгружена заявка на закупку',

  'prices.update': 'Правка цены',
  'prices.import': 'Импорт прайса',
  'prices.export': 'Выгрузка прайса',

  'user.create': 'Заведена учётная запись',
  'user.update': 'Изменена учётная запись',
  'user.profile': 'Правка личных данных',
  'user.password_change': 'Смена своего пароля',
  'user.password_reset': 'Сброс пароля сотруднику',
  'user.logout_all': 'Выход на всех устройствах',

  'db.backup': 'Снят дамп базы',
  'db.backup.download': 'Дамп выгружен',
  'db.backup.upload': 'Дамп загружен',
  'db.backup.delete': 'Дамп удалён',
  'db.restore': 'База восстановлена из дампа',

  'template.nozzle_norm.upsert': 'Правка норм патрубков',
  'template.nozzle_norm.delete': 'Удалена норма патрубка',
  'template.pipe_weight.upsert': 'Правка весов труб',
  'template.pipe_weight.delete': 'Удалён вес трубы',
  'template.engineering.upsert': 'Правка инженерной матрицы',
  'template.joint_layer.upsert': 'Правка Мс на стыке',
  'template.node.create': 'Создан узел каталога',
  'template.node.publish': 'Опубликован узел',
  'template.node.activate': 'Возврат версии узла',
  'template.node.archive': 'Узел в архив',
  'template.node.discard': 'Отменён черновик узла',
  'template.product.publish': 'Опубликован шаблон изделия',
  'template.product.activate': 'Возврат версии шаблона',
  'template.product.discard': 'Отменён черновик шаблона',
}

/** События, которые стоит замечать: неудачный вход, удаление, восстановление. */
const ALARMING = new Set([
  'auth.login_failed',
  'estimate.delete',
  'project.delete',
  'db.restore',
  'db.backup.download',
  'db.backup.delete',
  'user.password_reset',
])

/** Название события; неизвестное — своим кодом. */
export function auditLabel(action: string): string {
  return AUDIT_LABELS[action] ?? action
}

/** Раздел события: приставка кода до первой точки. */
export function auditGroupKey(action: string): string {
  return action.split('.')[0] ?? action
}

/** Название раздела; неизвестный — своей приставкой. */
export function auditGroupLabel(action: string): string {
  const key = auditGroupKey(action)
  return AUDIT_GROUPS.find((g) => g.key === key)?.label ?? key
}

/** Событие, на которое администратору стоит посмотреть внимательнее. */
export function isAlarming(action: string): boolean {
  return ALARMING.has(action)
}

/** Тип объекта по-русски: в журнале он записан именем модели. */
export function entityLabel(entityType: string | null): string | null {
  if (!entityType) return null
  const map: Record<string, string> = {
    Estimate: 'расчёт',
    Project: 'проект',
    User: 'сотрудник',
    PriceItem: 'позиция прайса',
    PriceListVersion: 'версия прайса',
    NodeDef: 'узел каталога',
    ProductTemplate: 'шаблон изделия',
    Backup: 'дамп',
  }
  return map[entityType] ?? entityType
}

/** Подписи ключей `meta` — то, что различает события одного вида. */
const META_LABELS: Readonly<Record<string, string>> = {
  email: 'почта',
  reason: 'причина',
  title: 'название',
  customer: 'заказчик',
  changed: 'поля',
  name: 'имя',
  position: 'должность',
  role: 'роль',
  isActive: 'активна',
  deviceType: 'изделие',
  project: 'проект',
  totalRub: 'итог, ₽',
  snapshotVersion: 'редакция',
  priceListVersion: 'версия прайса',
  kpNumber: 'номер КП',
  format: 'формат',
  positions: 'позиций',
  rows: 'строк',
  count: 'строк',
  totalCheck: 'сверка итога',
  version: 'версия',
  file: 'файл',
  restored: 'из дампа',
  safetyDump: 'точка возврата',
  from: 'было',
  to: 'стало',
  status: 'статус',
}

/** Значение `meta` строкой: списки — через запятую, объекты — коротким JSON. */
function metaValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (Array.isArray(value)) return value.map((v) => metaValue(v)).join(', ')
  if (typeof value === 'boolean') return value ? 'да' : 'нет'
  if (typeof value === 'number') return value.toLocaleString('ru-RU')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** Подробности события парами «подпись — значение»; пустые опускаются. */
export function auditDetails(meta: unknown): Array<{ label: string; value: string }> {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return []
  return Object.entries(meta as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0))
    .map(([key, value]) => ({ label: META_LABELS[key] ?? key, value: metaValue(value) }))
}
