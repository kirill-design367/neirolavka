#!/usr/bin/env bash
#
# Сертификат Let's Encrypt, автопродление и боевая конфигурация nginx.
#
# Запускать НА СЕРВЕРЕ от root ПОСЛЕ того, как A-записи домена начали
# указывать сюда:
#
#   cd /opt/neirolavka-repo && git pull origin main && sudo bash scripts/server-tls.sh
#
# Если клон делался без «-b main», он стоит на старой ветке по умолчанию,
# и скриптов в ней нет. Скрипт это проверяет и говорит, что делать.
#
# Раньше запускать бессмысленно: Let's Encrypt проверяет владение
# доменом, обращаясь к нему по имени. Пока имя ведёт на заглушку
# регистратора, проверка приходит не сюда и выпуск не проходит.
# Скрипт это проверяет сам и отказывается работать вхолостую —
# у Let's Encrypt есть предел неудачных попыток (5 в час на домен),
# и упереться в него из-за поспешности неприятно.

set -euo pipefail

DOMEN="${DOMEN:-neirolavka.ru}"
POCHTA="${POCHTA:-}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ACME="/var/www/acme"

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
# 1. Куда на самом деле смотрит домен
# ─────────────────────────────────────────────────────────────────────
shag "Проверка DNS"
MOY_IP="$(hostname -I | awk '{print $1}')"
adresa() { getent ahostsv4 "$1" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' '; }

A_GOL="$(adresa "$DOMEN")"
A_WWW="$(adresa "www.$DOMEN")"
echo "   этот сервер:      $MOY_IP"
echo "   $DOMEN:      ${A_GOL:-ничего не вернулось}"
echo "   www.$DOMEN:  ${A_WWW:-ничего не вернулось}"

BEDA=нет
case " $A_GOL " in *" $MOY_IP "*) ok "$DOMEN смотрит сюда" ;; *) vni "$DOMEN смотрит НЕ сюда"; BEDA=да ;; esac
case " $A_WWW " in *" $MOY_IP "*) ok "www.$DOMEN смотрит сюда" ;; *) vni "www.$DOMEN смотрит НЕ сюда"; BEDA=да ;; esac

if [ "$BEDA" = да ]; then
  echo
  echo "   Записи ещё не переехали или не разошлись по кешам."
  echo "   Ждём и запускаем снова. Ничего не сломано."
  exit 2
fi

# Проверочный файл должен доехать: если сюда приходит не наш nginx,
# выпуск всё равно не пройдёт, только потратит попытку.
shag "Проверка пути ACME"
install -d -o deploy -g www-data -m 755 "$ACME/.well-known/acme-challenge"
PROBA="proba-$$"
echo "$PROBA" > "$ACME/.well-known/acme-challenge/$PROBA"
OTVET="$(curl -fsS --max-time 10 "http://$DOMEN/.well-known/acme-challenge/$PROBA" || true)"
rm -f "$ACME/.well-known/acme-challenge/$PROBA"
if [ "$OTVET" = "$PROBA" ]; then
  ok "проверочный файл забирается по http — Let's Encrypt дойдёт"
else
  vni "проверочный файл не забирается: получено «${OTVET:-пусто}»"
  vni "выпуск не начинаю, чтобы не тратить попытку"
  exit 3
fi

# ─────────────────────────────────────────────────────────────────────
# 2. Выпуск
#
# certonly --webroot, а не плагин --nginx: плагин переписывает
# конфигурацию сам, вставляя свои редиректы, и наша схема «в один шаг»
# после него превращается в цепочку. Здесь certbot только кладёт файл
# в /var/www/acme и получает сертификат, а конфигурацию ставим мы.
# ─────────────────────────────────────────────────────────────────────
shag "Сертификат"
if [ -f "/etc/letsencrypt/live/$DOMEN/fullchain.pem" ]; then
  ok "сертификат уже есть, обновляю список имён при необходимости"
fi
POCHTA_ARG=(--register-unsafely-without-email)
[ -n "$POCHTA" ] && POCHTA_ARG=(--email "$POCHTA" --no-eff-email)

certbot certonly \
  --webroot -w "$ACME" \
  -d "$DOMEN" -d "www.$DOMEN" \
  --agree-tos "${POCHTA_ARG[@]}" \
  --keep-until-expiring \
  --non-interactive
ok "выпущен на: $(openssl x509 -in "/etc/letsencrypt/live/$DOMEN/cert.pem" -noout -text | grep -A1 'Subject Alternative Name' | tail -1 | tr -d ' ')"
ok "годен до: $(openssl x509 -in "/etc/letsencrypt/live/$DOMEN/cert.pem" -noout -enddate | cut -d= -f2)"

# ─────────────────────────────────────────────────────────────────────
# 3. Боевая конфигурация
# ─────────────────────────────────────────────────────────────────────
shag "Боевая конфигурация nginx"
NEIRO_NGINX_V="$(nginx -v 2>&1 | sed 's|.*/||' | tr -d '[:space:]')"
# Проба во временном дереве, снимок, подмена, контрольная проверка
# с откатом — всё в neiro_postavit. Живая конфигурация не заменяется,
# пока проба не прошла.
if ! neiro_postavit neirolavka.conf "$REPO"; then
  vni "боевая конфигурация не поставлена, сайт остался на прежней"
  exit 1
fi
systemctl reload nginx
ok "боевая конфигурация поставлена и перезагружена"

# ─────────────────────────────────────────────────────────────────────
# 4. Автопродление
#
# Мало включить таймер: если после продления не перезагрузить nginx,
# он будет отдавать старый сертификат до ближайшей перезагрузки — то
# есть, возможно, уже просроченный. Крючок это чинит.
# ─────────────────────────────────────────────────────────────────────
shag "Автопродление"
install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/perezagruzit-nginx.sh <<'EOF'
#!/bin/sh
# Выполняется ПОСЛЕ успешного продления. Без него nginx продолжает
# держать в памяти прежний сертификат.
nginx -t && systemctl reload nginx
EOF
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/perezagruzit-nginx.sh
systemctl enable --now certbot.timer > /dev/null 2>&1 || true
ok "таймер: $(systemctl is-enabled certbot.timer 2>/dev/null || echo 'нет'), $(systemctl is-active certbot.timer 2>/dev/null || echo 'не запущен')"
systemctl list-timers certbot.timer --no-pager 2>/dev/null | sed -n '2p' | sed 's/^/     /'

shag "Проверка продления вхолостую"
if certbot renew --dry-run --webroot -w "$ACME" 2>&1 | tail -20; then
  ok "продление отработало вхолостую — значит отработает и по-настоящему"
else
  vni "продление вхолостую НЕ прошло, разберитесь: журнал в /var/log/letsencrypt/"
fi

# ─────────────────────────────────────────────────────────────────────
# 5. Переходы: по одному шагу, без цепочек
# ─────────────────────────────────────────────────────────────────────
shag "Переходы"
shag_proverit() {                 # откуда, ожидаемое куда
  local ot="$1" kuda="$2"
  local kod loc
  kod="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$ot")"
  loc="$(curl -s -o /dev/null -w '%{redirect_url}' --max-time 10 "$ot")"
  if [ "$kuda" = "-" ]; then
    [ "$kod" = 200 ] && ok "$ot → $kod" || vni "$ot → $kod, ожидали 200"
  elif [ "$loc" = "$kuda" ] && [ "$kod" = 301 ]; then
    ok "$ot → $kod → $loc (один шаг)"
  else
    vni "$ot → $kod → ${loc:-никуда}, ожидали 301 на $kuda"
  fi
}
shag_proverit "http://$DOMEN/"      "https://$DOMEN/"
shag_proverit "http://www.$DOMEN/"  "https://$DOMEN/"
shag_proverit "https://www.$DOMEN/" "https://$DOMEN/"
shag_proverit "https://$DOMEN/"     "-"

# ─────────────────────────────────────────────────────────────────────
# 6. IPv6 — фактически, а не по документации
# ─────────────────────────────────────────────────────────────────────
shag "IPv6"
V6="$(ip -6 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1 || true)"
if [ -z "$V6" ]; then
  vni "глобального адреса IPv6 у сервера нет — AAAA-запись НЕ заводить"
else
  echo "   адрес: $V6"
  if ss -ltn 2>/dev/null | grep -qE '\[::\]:443|\*:443'; then
    ok "nginx слушает 443 по IPv6"
  else
    vni "nginx НЕ слушает 443 по IPv6 — AAAA-запись не заводить"
    V6=""
  fi
  if [ -n "$V6" ]; then
    if curl -6 -fsS --max-time 10 -o /dev/null --resolve "$DOMEN:443:$V6" "https://$DOMEN/"; then
      ok "сайт по IPv6 отдаётся — AAAA-запись заводить МОЖНО"
    else
      vni "сайт по IPv6 НЕ отдаётся — AAAA-запись НЕ заводить"
    fi
  fi
fi

shag "Готово"
echo "   Дальше: убедиться, что секреты на GitHub заполнены, и толкнуть main."
