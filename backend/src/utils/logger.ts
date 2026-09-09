import winston from 'winston'

const isProd = process.env.NODE_ENV === 'production'

/**
 * Логгер приложения.
 *
 * Три вещи, из-за которых прежний лог был непригоден для разбора инцидента:
 *
 *  1. метка времени была без даты (`HH:mm:ss`) — события разных суток
 *     неразличимы, а `docker logs` за неделю превращался в кашу;
 *  2. `colorize()` работал и в проде — в файл и в `docker logs` уходили
 *     ANSI-последовательности, ломающие grep и любой сборщик логов;
 *  3. форматтер брал только `timestamp/level/message` и МОЛЧА выбрасывал
 *     остальное. Именно там лежала вся полезная нагрузка: какие строки
 *     импорта прайса пропущены и почему, что не удалось записать в аудит.
 *
 * В проде — JSON-строки, они разбираются сборщиком логов как есть. В разработке
 * — читаемая строка с цветом и дописанным хвостом метаданных.
 */
const devFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize(),
  winston.format.printf((info) => {
    const { timestamp, level, message, stack, ...rest } = info
    const tail = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : ''
    return `${timestamp} [${level}] ${message}${tail}${stack ? `\n${stack}` : ''}`
  }),
)

const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
)

export const logger = winston.createLogger({
  level: isProd ? 'info' : 'debug',
  format: isProd ? prodFormat : devFormat,
  transports: [new winston.transports.Console()],
})
