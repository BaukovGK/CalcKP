/**
 * Markdown инструкций: всё, что в них встречается, и ничего сверх того.
 */
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

describe('разметка инструкций', () => {
  it('заголовок первого уровня — в title, второго и третьего — в оглавление', () => {
    const d = renderMarkdown('# Инструкция\n\n## 1. Вход\n\n### 1.1 Пароль\n\n#### Мелочь')
    expect(d.title).toBe('Инструкция')
    expect(d.html).not.toContain('<h1')
    expect(d.toc).toEqual([
      { id: 's1', text: '1. Вход', level: 2 },
      { id: 's2', text: '1.1 Пароль', level: 3 },
    ])
    expect(d.html).toContain('<h2 id="s1">1. Вход</h2>')
    expect(d.html).toContain('<h4 id="s3">Мелочь</h4>')
  })

  it('абзац склеивает строки, полужирный и код в строке', () => {
    const d = renderMarkdown('Нажмите **«Сохранить»**\nи откройте `img/admin`.')
    expect(d.html).toBe('<p>Нажмите <strong>«Сохранить»</strong> и откройте <code>img/admin</code>.</p>')
  })

  it('HTML в тексте экранируется', () => {
    const d = renderMarkdown('Значение <script>alert(1)</script> & «x»')
    expect(d.html).toContain('&lt;script&gt;')
    expect(d.html).not.toContain('<script>')
  })

  it('таблица с выравниванием столбцов', () => {
    const d = renderMarkdown('| Роль | Да |\n|---|:-:|\n| Администратор | ✓ |\n| Менеджер |')
    expect(d.html).toContain('<th>Роль</th><th class="al-center">Да</th>')
    expect(d.html).toContain('<td>Администратор</td><td class="al-center">✓</td>')
    // недостающая ячейка — пустая, а не сдвиг строки
    expect(d.html).toContain('<td>Менеджер</td><td class="al-center"></td>')
  })

  it('нумерованный список с вложенным маркированным', () => {
    const d = renderMarkdown('1. Откройте окно.\n2. Заполните:\n   - **ФИО**;\n   - роль.\n3. Нажмите «Создать».')
    expect(d.html).toBe('<ol><li>Откройте окно.</li><li>Заполните:<ul><li><strong>ФИО</strong>;</li><li>роль.</li></ul></li><li>Нажмите «Создать».</li></ol>')
  })

  it('пункты через пустую строку — один список', () => {
    const d = renderMarkdown('1. Первый.\n\n2. Второй.')
    expect(d.html).toBe('<ol><li>Первый.</li><li>Второй.</li></ol>')
  })

  it('список, начатый не с единицы, сохраняет номер', () => {
    expect(renderMarkdown('3. Третий.').html).toBe('<ol start="3"><li>Третий.</li></ol>')
  })

  it('рисунок отдельной строкой — с подписью и ссылкой на полный размер', () => {
    const d = renderMarkdown('![Рис. 1. Меню](img/common/01.png)', { image: (s) => `/help/${s}` })
    expect(d.html).toBe('<figure><a href="/help/img/common/01.png" target="_blank" rel="noopener"><img src="/help/img/common/01.png" alt="Рис. 1. Меню" loading="lazy"></a><figcaption>Рис. 1. Меню</figcaption></figure>')
  })

  it('ссылка на другую инструкцию — переход внутри программы, прочие файлы — текстом', () => {
    const d = renderMarkdown('См. [инструкцию Менеджера](02_Менеджер.md) и [список](Список.md).', {
      doc: (h) => (h === '02_Менеджер.md' ? 'manager' : null),
    })
    expect(d.html).toBe('<p>См. <a href="#" data-doc="manager">инструкцию Менеджера</a> и список.</p>')
  })

  it('цитата; служебная — пропускается', () => {
    const d = renderMarkdown('> **Важно.** Текст.\n\n> О рисунках: см. список.', { skipQuote: (t) => t.includes('О рисунках') })
    expect(d.html).toBe('<blockquote><p><strong>Важно.</strong> Текст.</p></blockquote>')
  })

  it('блок кода — как есть, с переносами', () => {
    const d = renderMarkdown('```\nПроект → КП\n   └→ Заявка <xlsx>\n```')
    expect(d.html).toBe('<pre><code>Проект → КП\n   └→ Заявка &lt;xlsx&gt;</code></pre>')
  })

  it('разделитель и переводы строк Windows', () => {
    expect(renderMarkdown('Текст\r\n\r\n---\r\n').html).toBe('<p>Текст</p>\n<hr>')
  })
})
