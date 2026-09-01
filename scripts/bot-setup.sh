#!/usr/bin/env bash
#
# Установка бота Нейролавки на боевой сервер.
#
# Запускать НА СЕРВЕРЕ от root:
#
#   cd /opt/neirolavka-repo && sudo git pull origin main
#   sudo bash scripts/bot-setup.sh
#
# Скрипт идемпотентный: повторный запуск после git pull — это способ
# обновить настройку, а не «вспомнить, что я тогда правил руками».
# Он ничего не удаляет и не перезаписывает секреты, которые уже есть.
#
# Что делает по порядку:
#   1. проверяет, что клон на main и что пользователь bot существует;
#   2. ставит Node 22 и sqlite3, если их нет;
#   3. раскладывает папки: код, секреты, база, копии;
#   4. заводит недостающие секреты — ключ шифрования и секрет вебхука;
#   5. ставит службы systemd и таймер копий;
#   6. включает вебхуки в nginx;
#   7. поднимает бота, если токен уже положен.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOM_BOT=/home/bot/neirolavka-bot
ETC=/etc/neirolavka-bot
OKR="$ETC/okruzhenie"
BAZA_DIR=/var/lib/neirolavka-bot
KOPII=/var/backups/neirolavka-bot
NODE_NUZHEN=22

shag() { printf '\n\033[1m── %s\033[0m\n' "$*"; }
ok()   { printf '   ok   %s\n' "$*"; }
vni()  { printf '   !!   %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Запускать от root."; exit 1; }

# shellcheck source=scripts/lib-nginx.sh
. "$REPO/scripts/lib-nginx.sh"

VETKA="$(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
if [ "$VETKA" != main ] && [ "$VETKA" != '?' ]; then
  vni "клон на ветке «$VETKA», а нужна main:"
  vni "  cd $REPO && git fetch origin main && git checkout main"
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────
# 1. Пользователи
#
# Бот НЕ работает от root, и создавать его здесь заново не нужно:
# учётную запись завёл server-setup.sh. Если её нет — значит настройка
# сервера не проходила, и дальше идти бессмысленно.
# ─────────────────────────────────────────────────────────────────────
shag "Пользователи"
id bot >/dev/null 2>&1 || { vni "нет пользователя bot — сначала scripts/server-setup.sh"; exit 1; }
ok "bot есть"

if id deploy >/dev/null 2>&1; then
  # Выкладка кладёт код бота в /home/bot/neirolavka-bot. Ей нужен
  # доступ туда — и только туда: секреты лежат в /etc, база в /var/lib,
  # и ни того ни другого deploy не видит.
  usermod -aG bot deploy
  ok "deploy добавлен в группу bot"
fi

# ─────────────────────────────────────────────────────────────────────
# 2. Node и sqlite3
# ─────────────────────────────────────────────────────────────────────
shag "Node $NODE_NUZHEN и sqlite3"
NODE_EST=0
if command -v node >/dev/null 2>&1; then
  V="$(node -v | sed 's/^v//' | cut -d. -f1)"
  [ "$V" -ge "$NODE_NUZHEN" ] && NODE_EST=1
fi
if [ "$NODE_EST" -eq 1 ]; then
  ok "node $(node -v) уже стоит"
else
  # В Ubuntu 24.04 в репозитории Node 18, а нам нужен 22: бот собран
  # под современный ESM и node:test.
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_NUZHEN}.x" | bash -
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  ok "поставлен node $(node -v)"
fi

# sqlite3 нужен резервным копиям: VACUUM INTO делается им, а не ботом.
# Копия не должна зависеть от того, жив ли бот.
DEBIAN_FRONTEND=noninteractive apt-get install -y sqlite3 >/dev/null
ok "sqlite3 $(sqlite3 --version | awk '{print $1}')"

# ─────────────────────────────────────────────────────────────────────
# 3. Папки
#
# Раскладка выбрана так, чтобы утечка ключа выкладки не отдавала ни
# секретов, ни базы: выкладка пишет ТОЛЬКО в папку кода.
# ─────────────────────────────────────────────────────────────────────
shag "Папки"
# setgid и права группы: выкладка ходит сюда под deploy, который
# состоит в группе bot. Новые файлы получают группу bot сами.
#
# Права на САМУ папку, а не только на releases, — потому что выкладка
# подменяет здесь ссылку current. Без записи в $DOM_BOT она разложила
# бы выпуск и упала бы на подмене ссылки, оставив рабочего бота
# на прежнем коде и красный прогон без внятной причины.
install -d -o bot   -g bot -m 2770 "$DOM_BOT"
install -d -o bot   -g bot -m 2770 "$DOM_BOT/releases"
# Секреты не читает НИКТО, кроме root: EnvironmentFile systemd
# читает от root и передаёт боту уже готовым окружением, а
# выкладка про них знать не должна вовсе.
install -d -o root  -g root -m 700 "$ETC"
install -d -o bot   -g bot -m 700  "$BAZA_DIR"
install -d -o bot   -g bot -m 700  "$KOPII"
# /home/bot должен быть проходим для группы: без этого deploy
# не доберётся до своей же папки.
chmod 750 /home/bot
chown bot:bot /home/bot
# Метка перезапуска: её кладёт выкладка, за ней следит systemd.
chmod 2770 "$DOM_BOT" "$DOM_BOT/releases"
touch "$DOM_BOT/perezapusk"
chown bot:bot "$DOM_BOT/perezapusk"
chmod 660 "$DOM_BOT/perezapusk"
ok "код: $DOM_BOT, секреты: $ETC, база: $BAZA_DIR, копии: $KOPII"

# ─────────────────────────────────────────────────────────────────────
# 4. Секреты
#
# Заводим только то, чего ещё нет. Уже существующий ключ шифрования
# перезаписать нельзя ни при каких обстоятельствах: с ним пропадут
# все выданные доступы.
# ─────────────────────────────────────────────────────────────────────
shag "Окружение"
if [ ! -f "$OKR" ]; then
  cp "$REPO/deploy/bot/okruzhenie.primer" "$OKR"
  ok "создан $OKR из образца"
else
  ok "$OKR уже есть, значения не трогаю"
  # Новые переменные из образца дописываем, существующие не трогаем:
  # иначе после обновления бот упадёт на незнакомой настройке.
  while IFS= read -r STROKA; do
    case "$STROKA" in
      ''|'#'*) continue ;;
    esac
    IMYA="${STROKA%%=*}"
    if ! grep -qE "^${IMYA}=" "$OKR"; then
      printf '%s\n' "$STROKA" >> "$OKR"
      ok "добавлена новая настройка $IMYA"
    fi
  done < "$REPO/deploy/bot/okruzhenie.primer"
fi
chown root:root "$OKR"
chmod 600 "$OKR"

# Дописать значение, если переменная пуста. Само значение НЕ печатаем.
zapolnit() {                      # имя, команда-генератор
  local imya="$1" gen="$2" tek
  tek="$(grep -E "^${imya}=" "$OKR" | head -1 | cut -d= -f2-)"
  if [ -z "$tek" ]; then
    local znach; znach="$($gen)"
    # sed по значению не годится: в base64 бывают слэши.
    python3 - "$OKR" "$imya" "$znach" <<'PY'
import io, sys
put, imya, znach = sys.argv[1], sys.argv[2], sys.argv[3]
stroki = io.open(put, encoding='utf-8').read().split('\n')
nashli = False
for i, s in enumerate(stroki):
    if s.startswith(imya + '='):
        stroki[i] = imya + '=' + znach
        nashli = True
        break
if not nashli:
    stroki.append(imya + '=' + znach)
io.open(put, 'w', encoding='utf-8').write('\n'.join(stroki))
PY
    ok "$imya создан (значение не печатаю)"
  else
    ok "$imya уже задан"
  fi
}
zapolnit NEIROLAVKA_SEKRET_VEBHUKA "openssl rand -hex 24"
zapolnit NEIROLAVKA_KLYUCH_DOSTUPOV "openssl rand -base64 32"
chown root:root "$OKR"; chmod 600 "$OKR"

TOKEN="$(grep -E '^NEIROLAVKA_TOKEN_BOTA=' "$OKR" | head -1 | cut -d= -f2-)"

# ─────────────────────────────────────────────────────────────────────
# 5. Службы
# ─────────────────────────────────────────────────────────────────────
shag "Службы systemd"
install -m 755 "$REPO/scripts/bot-kopiya.sh" /usr/local/bin/neirolavka-bot-kopiya.sh
for U in neirolavka-bot.service neirolavka-bot-perezapusk.service \
         neirolavka-bot-perezapusk.path neirolavka-bot-kopiya.service \
         neirolavka-bot-kopiya.timer; do
  install -m 644 "$REPO/deploy/systemd/$U" "/etc/systemd/system/$U"
done
systemctl daemon-reload
systemctl enable neirolavka-bot-perezapusk.path >/dev/null 2>&1 || true
systemctl start  neirolavka-bot-perezapusk.path >/dev/null 2>&1 || true
systemctl enable --now neirolavka-bot-kopiya.timer >/dev/null 2>&1 || true
ok "юниты поставлены, таймер копий: $(systemctl is-active neirolavka-bot-kopiya.timer 2>/dev/null || echo 'не запущен')"

# ─────────────────────────────────────────────────────────────────────
# 6. nginx: включить вебхуки
#
# Включение — это НАЛИЧИЕ ФАЙЛА, а не правка конфигурации руками.
# В neirolavka-static.conf стоит include по маске; маска, не совпавшая
# ни с чем, для nginx не ошибка. Поэтому «включено» и «выключено»
# различаются одним файлом, и обе стороны идемпотентны.
# ─────────────────────────────────────────────────────────────────────
shag "nginx"
NEIRO_NGINX_V="$(nginx -v 2>&1 | sed 's|.*/||' | tr -d '[:space:]')"
SAYT=neirolavka.http.conf
[ -f /etc/letsencrypt/live/neirolavka.ru/fullchain.pem ] && SAYT=neirolavka.conf
if ! neiro_postavit "$SAYT" "$REPO"; then
  vni "конфигурация nginx не обновилась, вебхуки не включаю"
  exit 1
fi
printf '%s\n' 'include /etc/nginx/snippets/neirolavka-bot.conf;' \
  > /etc/nginx/snippets/neirolavka-bot-vkl.conf
if nginx -t 2>&1 | sed 's/^/        /'; then
  systemctl reload nginx
  ok "вебхуки включены: /tg/… и /yookassa уходят на 127.0.0.1"
else
  rm -f /etc/nginx/snippets/neirolavka-bot-vkl.conf
  vni "с включёнными вебхуками конфигурация не проходит — откатил"
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────
# 7. Запуск
# ─────────────────────────────────────────────────────────────────────
shag "Бот"
if [ -z "$TOKEN" ]; then
  vni "токена в $OKR нет — бота не запускаю"
  echo
  echo "   Положить токен и запустить:"
  echo "     sudo sed -i 's|^NEIROLAVKA_TOKEN_BOTA=.*|NEIROLAVKA_TOKEN_BOTA=СЮДА_ТОКЕН|' $OKR"
  echo "     sudo systemctl enable --now neirolavka-bot"
  echo
  echo "   Токен берётся у @BotFather. В репозиторий он не попадает."
  exit 0
fi

if [ ! -e "$DOM_BOT/current" ]; then
  vni "выпуск ещё не выложен: $DOM_BOT/current не существует"
  echo "   Толкните main — прогон deploy-bot.yml разложит код и поднимет бота."
  exit 0
fi

systemctl enable neirolavka-bot >/dev/null 2>&1 || true
systemctl restart neirolavka-bot
sleep 3
PORT="$(grep -E '^NEIROLAVKA_PORT=' "$OKR" | head -1 | cut -d= -f2-)"
PORT="${PORT:-8080}"
if curl -fsS --max-time 5 "http://127.0.0.1:$PORT/health" >/dev/null; then
  ok "бот жив: $(curl -fsS "http://127.0.0.1:$PORT/vypusk" || echo '?')"
  ok "состояние: $(systemctl is-active neirolavka-bot)"
else
  vni "бот не отвечает на /health. Журнал:"
  journalctl -u neirolavka-bot -n 30 --no-pager | sed 's/^/        /'
  exit 1
fi

shag "Готово"
echo "   Проверить снаружи:  curl -sI https://neirolavka.ru/bot-health"
echo "   Журнал:             sudo journalctl -u neirolavka-bot -f"
echo "   Копии базы:         ls -la $KOPII"
