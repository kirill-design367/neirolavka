#!/usr/bin/env bash
#
# Разбор юнитов systemd настоящим systemd.
#
# Написан после того, как `StartLimitIntervalSec` полгода простоял
# в секции [Service], где systemd его молча игнорирует. Молча — это
# ключевое: служба поднимается, ошибок нет, а настройка не действует.
# Увидеть такое можно только этой командой, и то по предупреждению
# в потоке ошибок.
#
# Поэтому здесь предупреждения приравнены к ошибкам: всё, что systemd
# «ignoring», для нас поломка.

set -uo pipefail
KOREN="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BEDA=0

command -v systemd-analyze >/dev/null 2>&1 || {
  echo "systemd-analyze не найден — проверить юниты нечем"; exit 1;
}

for F in "$KOREN"/deploy/systemd/*.service "$KOREN"/deploy/systemd/*.path "$KOREN"/deploy/systemd/*.timer; do
  [ -f "$F" ] || continue
  IMYA="$(basename "$F")"
  VYVOD="$(systemd-analyze verify "$F" 2>&1 || true)"
  # «not executable» — про пути, которых нет в среде проверки
  # (node, systemctl лежат на сервере, а не у нас). Это не про юнит.
  PLOHO="$(printf '%s\n' "$VYVOD" | grep -vE 'not executable|^$' || true)"
  if [ -n "$PLOHO" ]; then
    echo "!! $IMYA"
    printf '%s\n' "$PLOHO" | sed 's/^/     /'
    BEDA=1
  else
    echo "ok $IMYA"
  fi
done

if [ "$BEDA" -ne 0 ]; then
  echo
  echo "Юниты не проходят разбор. Чаще всего это ключ не в той секции:"
  echo "systemd принимает файл, печатает «ignoring» и настройку не применяет."
  exit 1
fi
echo "все юниты разобраны без замечаний"
