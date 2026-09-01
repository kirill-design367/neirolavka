#!/usr/bin/env bash
#
# Настройка боевого сервера Нейролавки с нуля. Ubuntu 24.04.
#
# Запускать НА СЕРВЕРЕ, из клона репозитория, от root:
#
#   apt-get update && apt-get install -y git
#   git clone -b main https://github.com/kirill-design367/neirolavka.git /opt/neirolavka-repo
#   cd /opt/neirolavka-repo
#   ADMIN_USER=kirill ADMIN_KEY="ssh-ed25519 AAAA... вы@ноутбук" bash scripts/server-setup.sh
#
# «-b main» обязательно. Без него git берёт ветку по умолчанию, а она
# у репозитория старая, и скриптов в ней нет вовсе.
#
# Скрипт идемпотентный: его можно гонять сколько угодно раз. Повторный
# запуск после `git pull` — это способ обновить конфигурацию nginx.
#
# Что он НЕ делает: не выпускает сертификат (для этого нужен переехавший
# домен — см. scripts/server-tls.sh) и не ставит бота (его ещё нет).

set -euo pipefail

DOMEN="${DOMEN:-neirolavka.ru}"
ADMIN_USER="${ADMIN_USER:-}"
ADMIN_KEY="${ADMIN_KEY:-}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
BOT_USER="${BOT_USER:-bot}"
KOREN="/var/www/neirolavka"
ACME="/var/www/acme"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

shag() { printf '\n\033[1m── %s\033[0m\n' "$*"; }
ok()   { printf '   ok   %s\n' "$*"; }
vni()  { printf '   !!   %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Запускать от root."; exit 1; }

# shellcheck source=scripts/lib-nginx.sh
. "$REPO/scripts/lib-nginx.sh"

# Ветка. У репозитория веткой по умолчанию стоит старая, и `git clone`
# без -b тянет именно её. Сказать об этом здесь дешевле, чем разбираться
# потом, почему конфигурация не та.
VETKA="$(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
if [ "$VETKA" != main ] && [ "$VETKA" != '?' ]; then
  vni "клон на ветке «$VETKA», а нужна main:"
  vni "  cd $REPO && git fetch origin main && git checkout main"
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────
# 0. Проверка входных данных ДО того, как что-то менять
#
# Отключать вход по паролю, не убедившись, что ключ на месте и разбирается,
# — это способ запереть себя снаружи. Поэтому проверка идёт первой.
# ─────────────────────────────────────────────────────────────────────
shag "Проверка входных данных"
if [ -z "$ADMIN_USER" ]; then
  echo "Не задан ADMIN_USER — имя вашей учётной записи на сервере."; exit 1
fi
if [ -z "$ADMIN_KEY" ]; then
  if [ -s "/home/$ADMIN_USER/.ssh/authorized_keys" ]; then
    ok "ADMIN_KEY не задан, но ключ у $ADMIN_USER уже лежит — беру его"
  else
    echo "Не задан ADMIN_KEY, и у $ADMIN_USER нет ключа."
    echo "Без ключа отключать вход по паролю нельзя: потеряете доступ."
    exit 1
  fi
else
  tmp="$(mktemp)"; printf '%s\n' "$ADMIN_KEY" > "$tmp"
  if ! ssh-keygen -l -f "$tmp" > /dev/null 2>&1; then
    echo "ADMIN_KEY не разбирается как открытый ключ SSH. Проверьте, что это"
    echo "содержимое файла ~/.ssh/id_ed25519.pub целиком, одной строкой."
    rm -f "$tmp"; exit 1
  fi
  ok "открытый ключ администратора разобран: $(ssh-keygen -l -f "$tmp")"
  rm -f "$tmp"
fi

# ─────────────────────────────────────────────────────────────────────
# 1. Часовой пояс и обновления
# ─────────────────────────────────────────────────────────────────────
shag "Часовой пояс"
timedatectl set-timezone Europe/Moscow
ok "$(timedatectl show -p Timezone --value), сейчас $(date '+%F %T %Z')"

shag "Обновление системы"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get -y -qq upgrade
apt-get -y -qq install \
  nginx ufw fail2ban unattended-upgrades \
  certbot rsync git curl ca-certificates acl
ok "пакеты установлены, nginx $(nginx -v 2>&1 | sed 's|.*/||')"

# ─────────────────────────────────────────────────────────────────────
# 2. Учётные записи
#
# Три штуки, и у каждой своя причина:
#   admin  — человек, единственный с sudo;
#   deploy — выкладка сайта из GitHub Actions, БЕЗ sudo. Если ключ
#            выкладки утечёт, отдать он может максимум содержимое
#            /var/www/neirolavka;
#   bot    — будущий бот, БЕЗ sudo и без доступа к сайту. Бот работает
#            с деньгами и токенами, его нельзя пускать никуда ещё.
# ─────────────────────────────────────────────────────────────────────
zavesti() {                      # имя, домашняя папка, sudo да/нет
  local u="$1" dom="$2" sudo_li="$3"
  if id -u "$u" > /dev/null 2>&1; then
    ok "пользователь $u уже есть"
  else
    adduser --disabled-password --gecos "" --home "$dom" "$u" > /dev/null
    ok "пользователь $u заведён, домашняя папка $dom"
  fi
  # Пароль не трогаем ни у кого, и это осознанно. adduser заводит
  # новых с «*» в теневом файле — паролем войти нельзя. А вот сбросить
  # или заблокировать пароль УЖЕ существующему администратору значило бы
  # сломать ему sudo: sudo спрашивает пароль пользователя. Вход по паролю
  # снаружи всё равно закрыт в настройках sshd.
  install -d -m 700 -o "$u" -g "$u" "$dom/.ssh"
  touch "$dom/.ssh/authorized_keys"
  chown "$u:$u" "$dom/.ssh/authorized_keys"
  chmod 600 "$dom/.ssh/authorized_keys"
  if [ "$sudo_li" = "да" ]; then
    usermod -aG sudo "$u"
  else
    gpasswd -d "$u" sudo > /dev/null 2>&1 || true
  fi
}

shag "Учётные записи"
zavesti "$ADMIN_USER"  "/home/$ADMIN_USER"  да
zavesti "$DEPLOY_USER" "/home/$DEPLOY_USER" нет
zavesti "$BOT_USER"    "/home/$BOT_USER"    нет

if [ -n "$ADMIN_KEY" ]; then
  akl="/home/$ADMIN_USER/.ssh/authorized_keys"
  grep -qxF "$ADMIN_KEY" "$akl" || printf '%s\n' "$ADMIN_KEY" >> "$akl"
  ok "ключ администратора на месте, ключей в файле: $(grep -c . "$akl")"
fi

# Ключ выкладки создаётся ЗДЕСЬ, а не у меня и не на вашей машине:
# закрытая половина не должна путешествовать лишний раз. Печатается
# он один раз — сразу в секрет GitHub.
shag "Ключ выкладки"
KLYUCH="/home/$DEPLOY_USER/.ssh/id_deploy"
NOVYY=нет
if [ ! -f "$KLYUCH" ]; then
  sudo -u "$DEPLOY_USER" ssh-keygen -t ed25519 -N "" -C "github-actions@neirolavka" -f "$KLYUCH" > /dev/null
  NOVYY=да
  ok "пара ключей создана"
else
  ok "пара ключей уже есть — та же самая, новую не завожу"
fi
dak="/home/$DEPLOY_USER/.ssh/authorized_keys"
grep -qxF "$(cat "$KLYUCH.pub")" "$dak" || cat "$KLYUCH.pub" >> "$dak"
chown "$DEPLOY_USER:$DEPLOY_USER" "$dak"; chmod 600 "$dak"

# Печатается ЗДЕСЬ, а не только в итоге, и печатается всегда.
# Первый запуск умер на nginx — то есть до итога, — и ключ, уже
# созданный, человек не увидел. Ключ нужен для секрета GitHub;
# печатать его на каждом запуске не хуже, чем на первом: смотрит
# root в своём же терминале.
echo
echo "   ЗАКРЫТЫЙ КЛЮЧ ВЫКЛАДКИ — в секрет SSH_PRIVATE_KEY на GitHub."
echo "   Он же лежит на сервере: $KLYUCH"
echo "   ─────────────────────────────────────────────────────────"
cat "$KLYUCH"
echo "   ─────────────────────────────────────────────────────────"

# ─────────────────────────────────────────────────────────────────────
# 3. SSH: только ключи, root не входит
# ─────────────────────────────────────────────────────────────────────
shag "SSH"
cat > /etc/ssh/sshd_config.d/10-neirolavka.conf <<'EOF'
# Настройки Нейролавки. Лежат отдельным файлом, а не правкой
# sshd_config: обновление openssh-server перезаписывает основной файл,
# а этот каталог оно не трогает.
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
PermitEmptyPasswords no
X11Forwarding no
MaxAuthTries 3
LoginGraceTime 30
AllowAgentForwarding no
EOF
if sshd -t; then
  systemctl restart ssh 2>/dev/null || systemctl restart sshd
  ok "вход root запрещён, вход по паролю запрещён, только ключи"
else
  vni "sshd -t ругается, настройки НЕ применены — разберитесь до выхода из сессии"
  rm -f /etc/ssh/sshd_config.d/10-neirolavka.conf
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────
# 4. Файрвол: наружу только 22, 80, 443
# ─────────────────────────────────────────────────────────────────────
shag "Файрвол"
# Сброса правил при повторном запуске нет намеренно. `ufw --force reset`
# выключает файрвол и стирает правила; если скрипт умрёт между сбросом
# и включением, сервер останется вообще без файрвола. `ufw allow`
# и `ufw default` идемпотентны сами по себе, поэтому сброс нужен ровно
# один раз — когда ufw ещё не настроен нами.
if ufw status verbose 2>/dev/null | grep -q 'Status: active' \
   && ufw status 2>/dev/null | grep -q '22/tcp' \
   && ufw status 2>/dev/null | grep -q '80/tcp' \
   && ufw status 2>/dev/null | grep -q '443/tcp' \
   && ufw status verbose 2>/dev/null | grep -q 'deny (incoming)'; then
  ok "файрвол уже настроен как надо — не трогаю"
else
  ufw --force reset > /dev/null
  ufw default deny incoming > /dev/null
  ufw default allow outgoing > /dev/null
  ufw allow 22/tcp  comment 'SSH'   > /dev/null
  ufw allow 80/tcp  comment 'HTTP'  > /dev/null
  ufw allow 443/tcp comment 'HTTPS' > /dev/null
  ufw --force enable > /dev/null
fi
ok "$(ufw status | tr '\n' ' ' | sed 's/  */ /g')"

# ─────────────────────────────────────────────────────────────────────
# 5. Защита от перебора
# ─────────────────────────────────────────────────────────────────────
shag "fail2ban"
cat > /etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5
backend  = systemd
# Свои адреса не банить никогда.
ignoreip = 127.0.0.1/8 ::1

[sshd]
enabled = true
port    = ssh
# Перебор по SSH: пять промахов за десять минут — час бана.
# Пароля всё равно нет, но шум в журнале и нагрузку это убирает.
maxretry = 5
EOF
systemctl enable --now fail2ban > /dev/null
systemctl restart fail2ban
sleep 1
ok "$(fail2ban-client status sshd 2>/dev/null | tr '\n' ' ' | sed 's/\s\+/ /g' || echo 'запущен')"

# ─────────────────────────────────────────────────────────────────────
# 6. Автоматические обновления безопасности
#
# Перезагрузка НЕ автоматическая: перезагрузка среди ночи — это минуты
# недоступного сайта без причины. Ядро обновляем руками.
# ─────────────────────────────────────────────────────────────────────
shag "Автообновления безопасности"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
cat > /etc/apt/apt.conf.d/52neirolavka <<'EOF'
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF
systemctl enable --now unattended-upgrades > /dev/null
ok "включены, автоматической перезагрузки нет"

# ─────────────────────────────────────────────────────────────────────
# 7. Место под сайт и под бота
# ─────────────────────────────────────────────────────────────────────
shag "Папки"
install -d -o "$DEPLOY_USER" -g www-data -m 755 "$KOREN" "$KOREN/releases"
install -d -o "$DEPLOY_USER" -g www-data -m 755 "$ACME"
# Заглушка, чтобы nginx поднялся до первой выкладки.
if [ ! -e "$KOREN/current" ]; then
  install -d -o "$DEPLOY_USER" -g www-data -m 755 "$KOREN/releases/zaglushka"
  cat > "$KOREN/releases/zaglushka/index.html" <<'EOF'
<!doctype html><html lang="ru"><meta charset="utf-8">
<title>Нейролавка</title><body style="font:16px system-ui;padding:3rem">
Сервер готов, сайт ещё не выложен.</body></html>
EOF
  cp "$KOREN/releases/zaglushka/index.html" "$KOREN/releases/zaglushka/404.html"
  chown -R "$DEPLOY_USER:www-data" "$KOREN/releases/zaglushka"
  ln -sfn "$KOREN/releases/zaglushka" "$KOREN/current"
  chown -h "$DEPLOY_USER:www-data" "$KOREN/current"
fi
ok "сайт: $KOREN, текущий выпуск $(readlink -f "$KOREN/current")"

# Место под бота. Бот пишется следующим заходом; здесь только папка,
# пустой .env с правами 600 и права, при которых бота никто, кроме
# него самого и root, не прочитает.
BOT_DIR="/home/$BOT_USER/neirolavka-bot"
install -d -o "$BOT_USER" -g "$BOT_USER" -m 750 "$BOT_DIR"
if [ ! -f "$BOT_DIR/.env" ]; then
  cat > "$BOT_DIR/.env" <<'EOF'
# Секреты бота. Этот файл НИКОГДА не попадает в репозиторий.
# Права 600, владелец — пользователь bot.
#
# Заполнять по SSH руками:
#   TELEGRAM_BOT_TOKEN=
#   TELEGRAM_WEBHOOK_SECRET=
#   YOOKASSA_SHOP_ID=
#   YOOKASSA_SECRET_KEY=
EOF
fi
chown "$BOT_USER:$BOT_USER" "$BOT_DIR/.env"
chmod 600 "$BOT_DIR/.env"
ok "бот: $BOT_DIR, .env $(stat -c '%a %U:%G' "$BOT_DIR/.env")"

# ─────────────────────────────────────────────────────────────────────
# 8. IPv6: слушаем только если он реально есть
#
# Это не перестраховка. Если у домена появится AAAA-запись, браузер
# пойдёт по IPv6 ПЕРВЫМ. Нет адреса или nginx его не слушает — человек
# упирается в тишину, и виноват будет сайт.
# ─────────────────────────────────────────────────────────────────────
shag "IPv6"
V6="$(ip -6 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1 || true)"
if [ -n "$V6" ]; then
  printf 'listen [::]:80;\n'          > /etc/nginx/snippets/neirolavka-listen6-80.conf
  printf 'listen [::]:443 ssl;\n'     > /etc/nginx/snippets/neirolavka-listen6-443.conf
  ok "глобальный адрес есть: $V6 — nginx будет слушать IPv6"
  ok "AAAA-запись заводить МОЖНО, но только после проверки скриптом проверки боем"
else
  : > /etc/nginx/snippets/neirolavka-listen6-80.conf
  : > /etc/nginx/snippets/neirolavka-listen6-443.conf
  ok "глобального адреса IPv6 нет — nginx его не слушает"
  vni "AAAA-запись НЕ заводить: браузер пойдёт по IPv6 первым и упрётся в тишину"
fi
# default_server можно объявить только в одном месте на пару адрес:порт.
# Каталог snippets общий, поэтому строки для default-блоков отдельные.

# ─────────────────────────────────────────────────────────────────────
# 9. nginx
#
# Порядок здесь — часть устройства, а не оформление.
#
# 1. Гасим в стандартном nginx.conf директивы, которыми владеем мы.
#    Иначе `gzip on;` объявлен дважды (в стандартном файле строкой 46
#    и у нас), и nginx падает: файлы из conf.d подключаются в тот же
#    блок http. Гашение идемпотентно и трогает только активные строки.
#
# 2. Проверяем конфигурацию ВО ВРЕМЕННОМ дереве, до того как трогать
#    рабочую. Прошлый запуск клал файл, проверял и падал, оставляя
#    сервер с конфигурацией, которая не проходит nginx -t. Теперь
#    при неудачной пробе живое дерево вообще не меняется.
#
# 3. И только потом раскладываем по-настоящему, снимая перед этим
#    копию /etc/nginx — на случай, если живое дерево отличается от
#    пробного чем-то, чего проба не увидела.
# ─────────────────────────────────────────────────────────────────────
shag "nginx"
NEIRO_NGINX_V="$(nginx -v 2>&1 | sed 's|.*/||' | tr -d '[:space:]')"
ok "nginx $NEIRO_NGINX_V, http2 $(neiro_starshe "$NEIRO_NGINX_V" 1.25.1 && echo 'параметром listen' || echo 'директивой')"

# Какую конфигурацию ставить, решает наличие сертификата: боевая на него
# ссылается, и без него nginx просто не поднимется.
if [ -f "/etc/letsencrypt/live/$DOMEN/fullchain.pem" ]; then
  SAYT=neirolavka.conf
  ok "сертификат на месте — ставлю боевую конфигурацию с https"
else
  SAYT=neirolavka.http.conf
  ok "сертификата ещё нет — ставлю конфигурацию первого этапа (только http)"
fi

if ! neiro_postavit "$SAYT" "$REPO"; then
  vni "конфигурация nginx не поставлена. Сайт остался на прежней —"
  vni "рабочей — конфигурации, ничего не сломано."
  exit 1
fi

systemctl enable --now nginx > /dev/null
systemctl reload nginx
ok "nginx перезагружен"

# ─────────────────────────────────────────────────────────────────────
# 10. Что дальше
# ─────────────────────────────────────────────────────────────────────
shag "Готово"
# Адрес берём тот, с которого сервер выходит наружу, а НЕ первый
# из `hostname -I`: у VPS в этом списке первым запросто оказывается
# внутренний адрес, и известный хост получился бы для него.
IP4="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')"
[ -n "$IP4" ] || IP4="$(hostname -I | awk '{print $1}')"
echo "   Сервер:      $IP4"
echo "   Заходить:    ssh $ADMIN_USER@$IP4"
echo "   Сайт:        $KOREN/current  →  $(readlink -f "$KOREN/current")"
echo "   Бот:         $BOT_DIR/.env ($(stat -c '%a %U:%G' "$BOT_DIR/.env"))"
echo
echo "   Известный хост — вписать в секрет SSH_KNOWN_HOSTS на GitHub:"
# Берём ключ прямо из файла сервера, а не через ssh-keyscan.
#
# Так надёжнее по двум причинам. Во-первых, keyscan ходит по сети
# и молча отдаёт пустоту, если что-то не так, — а пустой секрет
# выглядит как заполненный. Во-вторых, у keyscan -H имя хоста
# зашифровано, и глазами не видно, для КАКОГО адреса ключ: если
# адрес взялся не тот, ошибка обнаружится только на выкладке
# и будет выглядеть как «Host key verification failed».
for T in ed25519 rsa; do
  F="/etc/ssh/ssh_host_${T}_key.pub"
  [ -f "$F" ] && awk -v ip="$IP4" '{print "     " ip, $1, $2}' "$F"
done
echo
echo "   Ключ выкладки ($( [ "$NOVYY" = да ] && echo 'создан сейчас' || echo 'был раньше, тот же самый' ))"
echo "   напечатан выше — в секрет SSH_PRIVATE_KEY. Повторно:"
echo "     sudo cat $KLYUCH"
echo
echo "   Дальше: поменять A-записи @ и www на $IP4, дождаться,"
echo "   и запустить  sudo bash scripts/server-tls.sh"
