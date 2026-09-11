import { randomInt } from 'node:crypto'

/**
 * Пароли: одна минимальная длина на всё приложение и временные пароли —
 * первого администратора и сброса администратором (План_устранения, 2.1).
 *
 * @module utils/password
 */

/** Минимальная длина пароля — везде одна: создание, смена, сброс. */
export const MIN_PASSWORD_LENGTH = 8

/**
 * Алфавит временных паролей — без похожих знаков (0 и O, 1, l и I): такой
 * пароль диктуют по телефону и переписывают с экрана.
 */
const TEMP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'

/**
 * Случайный временный пароль из криптостойкого генератора: 14 знаков из 55 —
 * около 80 бит. Сменить его обязательно при первом входе.
 */
export function temporaryPassword(length = 14): string {
  let s = ''
  for (let i = 0; i < length; i++) s += TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)]
  return s
}
