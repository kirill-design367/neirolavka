#!/usr/bin/env bash
#
# Резервная копия базы бота.
#
# Устанавливается bot-setup.sh как /usr/local/bin/neirolavka-bot-kopiya.sh
# и запускается таймером раз в шесть часов от пользователя bot.
#
# Копия снимается через VACUUM INTO: это согласованный снимок, который
# можно делать на живой базе, не останавливая бота. Простое `cp` файла
# в режиме WAL даёт битую копию — часть данных лежит в отдельном
# журнале, и она в неё не попадает.
#
# Копия ПРОВЕРЯЕТСЯ сразу после снятия. Резервная копия, о негодности
# которой узнают в день аварии, — это не резервная копия.

set -euo pipefail

BAZA="${NEIROLAVKA_BAZA:-/var/lib/neirolavka-bot/baza.sqlite}"
KUDA="${NEIROLAVKA_KOPII:-/var/backups/neirolavka-bot}"
HRANIT="${NEIROLAVKA_KOPIY_HRANIT:-28}"

[ -f "$BAZA" ] || { echo "базы нет: $BAZA — копировать нечего"; exit 0; }
install -d -m 700 "$KUDA"

METKA="$(date -u +%Y%m%d-%H%M%S)"
VREMENNO="$KUDA/nedodelannaya-$METKA.sqlite"
GOTOVO="$KUDA/baza-$METKA.sqlite"

# Незаконченная копия называется иначе, чем готовая: если процесс
# прервут посреди работы, обломок не притворится годной копией.
sqlite3 "$BAZA" "VACUUM INTO '$VREMENNO'"

PROVERKA="$(sqlite3 "$VREMENNO" 'PRAGMA integrity_check;' | head -1)"
if [ "$PROVERKA" != "ok" ]; then
  echo "копия НЕ прошла проверку целостности: $PROVERKA" >&2
  rm -f "$VREMENNO"
  exit 1
fi

# Заказы должны читаться — иначе копия «целая», но пустая.
ZAKAZOV="$(sqlite3 "$VREMENNO" 'SELECT COUNT(*) FROM zakazy;')"
mv -f "$VREMENNO" "$GOTOVO"
gzip -9 -f "$GOTOVO"
echo "копия готова: $GOTOVO.gz, заказов в ней $ZAKAZOV"

# Уборка: держим последние HRANIT копий. Незаконченные обломки старше
# суток уносим тоже.
mapfile -t LISHNIE < <(ls -1t "$KUDA"/baza-*.sqlite.gz 2>/dev/null | tail -n +"$((HRANIT + 1))")
if [ ${#LISHNIE[@]} -gt 0 ]; then
  rm -f "${LISHNIE[@]}"
  echo "убрано старых копий: ${#LISHNIE[@]}"
fi
find "$KUDA" -name 'nedodelannaya-*.sqlite' -mtime +1 -delete 2>/dev/null || true

# Копия ВНЕ сервера. Диск сервера и база на нём умирают вместе,
# поэтому суточная копия уходит владельцу в Telegram — если он этого
# захотел. В копии лежат заказы и ШИФРОТЕКСТЫ доступов; ключа от них
# там нет, он живёт в /etc и в копию не попадает.
if [ -n "${NEIROLAVKA_KOPIYA_V_TELEGRAM:-}" ] && [ -n "${NEIROLAVKA_TOKEN_BOTA:-}" ]; then
  CHAS="$(date -u +%H)"
  # Раз в сутки, а не каждые шесть часов: четыре одинаковых файла
  # в переписке — способ перестать их замечать.
  if [ "$CHAS" = "00" ] || [ -n "${NEIROLAVKA_KOPIYA_SEYCHAS:-}" ]; then
    KOMU="${NEIROLAVKA_VLADELCY%%,*}"
    KOMU="$(echo "$KOMU" | tr -d '[:space:]')"
    if [ -n "$KOMU" ]; then
      # Ответ Telegram печатаем без токена: адрес запроса его содержит.
      OTVET="$(curl -sS --max-time 120 \
        -F "chat_id=$KOMU" \
        -F "caption=Копия базы от $METKA. Заказов: $ZAKAZOV." \
        -F "document=@$GOTOVO.gz" \
        "https://api.telegram.org/bot${NEIROLAVKA_TOKEN_BOTA}/sendDocument" || echo '{}')"
      case "$OTVET" in
        *'"ok":true'*) echo "копия отправлена владельцу" ;;
        *) echo "копию владельцу отправить не удалось" >&2 ;;
      esac
    fi
  fi
fi
