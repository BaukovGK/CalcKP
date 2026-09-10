-- Нормализация наименований прайса — те же правила, что в
-- backend/src/utils/price-name.ts (сверено по price-name.vectors.json).
--
-- Позиции, заведённые из листа «НН», несли невидимые различия: неразрывные
-- и тонкие пробелы, двойные пробелы, латиницу вместо кириллицы («ГOCT»,
-- «мA», «108x8», «M12-7H»). Ключ цены — тройка (категория, наименование,
-- ЕИ), и такая позиция не находилась по правильному наименованию. Импорт
-- теперь приводит наименования сам; миграция приводит то, что уже в базе.
--
-- Если две позиции после приведения совпали, остаётся одна: уже записанная
-- в каноническом виде, иначе — с ценой, иначе — обновлённая последней.
-- История цен удаляемой переезжает к оставшейся.
--
-- Невидимые символы заданы через chr(), а не литералами: в тексте миграции
-- их не было бы видно, а при правке — легко потерять.

-- 0. Классы символов.
--    zw — нулевой ширины: U+200B…U+200D, U+2060;
--    sp — пробельные, как \s в JavaScript: U+0009…U+000D, пробел, U+00A0,
--         U+1680, U+2000…U+200A, U+2028, U+2029, U+202F, U+205F, U+3000,
--         U+FEFF.
CREATE TEMP TABLE price_chars AS
SELECT
  '[' || chr(8203) || '-' || chr(8205) || chr(8288) || ']' AS zw,
  '[' || chr(9) || '-' || chr(13) || ' ' || chr(160) || chr(5760)
      || chr(8192) || '-' || chr(8202) || chr(8232) || chr(8233) || chr(8239)
      || chr(8287) || chr(12288) || chr(65279) || ']+' AS sp;

-- 1. Пробелы: нулевой ширины прочь, пробельные серии — в один пробел,
--    по краям — прочь. Для категорий и ЕИ этим всё и ограничивается.
CREATE TEMP TABLE price_norm AS
SELECT
  p.id,
  btrim(regexp_replace(regexp_replace(p.category, c.zw, '', 'g'), c.sp, ' ', 'g')) AS new_category,
  btrim(regexp_replace(regexp_replace(p.name, c.zw, '', 'g'), c.sp, ' ', 'g')) AS new_name,
  btrim(regexp_replace(regexp_replace(p.unit, c.zw, '', 'g'), c.sp, ' ', 'g')) AS new_unit
FROM "PriceItem" p
CROSS JOIN price_chars c;

-- 2. Латиница на месте кириллицы — в том же порядке, что в price-name.ts:
--    «ГOCT» → «ГОСТ»; «108x8» → «108х8»; «мA» → «мА»; «M12» → «М12»;
--    «М12-7H» → «М12-7Н»; «ɡ» (U+0261) → «g».
UPDATE price_norm SET new_name =
  regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(new_name, 'Г[OО][CС][TТ]', 'ГОСТ', 'g'),
            '(\d)x(?=\d)', '\1х', 'g'),
          'мA(?![A-Za-zА-Яа-яЁё])', 'мА', 'g'),
        '(^|[^A-Za-z])M(?=\d)', '\1М', 'g'),
      '([МM]\d+(?:[.,]\d+)?-\d)H', '\1Н', 'g'),
    chr(609), 'g', 'g');

-- 3. Совпавшие после приведения позиции: кого оставить.
CREATE TEMP TABLE price_merge AS
SELECT
  n.id,
  first_value(n.id) OVER (
    PARTITION BY n.new_category, n.new_name, n.new_unit
    ORDER BY
      (p.category = n.new_category AND p.name = n.new_name AND p.unit = n.new_unit) DESC,
      (p."priceRub" IS NOT NULL) DESC,
      p."updatedAt" DESC,
      p.id
  ) AS keep_id
FROM price_norm n
JOIN "PriceItem" p ON p.id = n.id;

UPDATE "PriceHistory" h
SET "priceItemId" = m.keep_id
FROM price_merge m
WHERE h."priceItemId" = m.id AND m.id <> m.keep_id;

DELETE FROM "PriceItem" p
USING price_merge m
WHERE p.id = m.id AND m.id <> m.keep_id;

-- 4. Новые наименования и производный ключ. Дату обновления не трогаем:
--    это правка написания, а не цены.
UPDATE "PriceItem" p
SET
  category = n.new_category,
  name = n.new_name,
  unit = n.new_unit,
  "lookupKey" = n.new_category || ':' || n.new_name || ':' || n.new_unit
FROM price_norm n
WHERE p.id = n.id
  AND (p.category <> n.new_category OR p.name <> n.new_name OR p.unit <> n.new_unit);

DROP TABLE price_merge;
DROP TABLE price_norm;
DROP TABLE price_chars;
