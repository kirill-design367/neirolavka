#!/usr/bin/env bash
#
# Общая часть server-setup.sh и server-tls.sh: раскладка конфигурации
# nginx так, чтобы она (а) не сталкивалась со стандартным nginx.conf
# дистрибутива и (б) никогда не оставляла сервер в состоянии, которое
# не проходит nginx -t.
#
# Подключается через `source`, сам по себе ничего не делает.

# ─────────────────────────────────────────────────────────────────────
# Директивы, которыми МЫ владеем целиком.
#
# Каждая из них объявлена в нашем conf.d/neirolavka-obshchee.conf,
# поэтому в стандартном /etc/nginx/nginx.conf она должна быть погашена.
# Иначе nginx падает: файлы из conf.d подключаются в тот же блок http,
# а такие директивы нельзя объявлять дважды.
#
# В списке есть и те, что в стандартном файле СЕГОДНЯ закомментированы
# (gzip_vary, gzip_proxied, gzip_comp_level, gzip_types, server_tokens).
# Гашение их — не пустая работа: строка вида «# gzip_vary on;» стоит
# в стандартном файле приглашением её раскомментировать, и в день,
# когда это сделает обновление дистрибутива или человек, мы получим
# ровно ту же поломку. Функция трогает только АКТИВНЫЕ строки, поэтому
# сегодня это ничего не стоит.
NEIRO_NASHI_DIREKTIVY=(
  gzip
  gzip_static
  gzip_vary
  gzip_comp_level
  gzip_min_length
  gzip_proxied
  gzip_types
  gzip_buffers
  gzip_http_version
  server_tokens
  ssl_protocols
  ssl_prefer_server_ciphers
  ssl_ciphers
  ssl_session_timeout
  ssl_session_cache
  ssl_session_tickets
)

NEIRO_METKA='# НЕЙРОЛАВКА: настройка живёт в conf.d/neirolavka-obshchee.conf'

# Погасить наши директивы в переданном nginx.conf. Идемпотентно:
# уже закомментированные строки не трогает, поэтому повторный запуск
# ничего не меняет. Печатает, что именно погасил.
neiro_pogasit_stock() {
  local f="$1" d pogasheno=()
  # Сохраняем нетронутый файл ОДИН раз, до первой правки: чтобы всегда
  # было к чему вернуться и с чем сравнить после обновления nginx.
  if [ ! -f "$f.neirolavka-do-pravki" ]; then
    cp -a "$f" "$f.neirolavka-do-pravki"
  fi
  for d in "${NEIRO_NASHI_DIREKTIVY[@]}"; do
    if grep -qE "^[[:space:]]*${d}[[:space:]]" "$f"; then
      # Комментируем строку ЦЕЛИКОМ: у ssl_protocols в стандартном файле
      # есть хвостовой комментарий, и обрезка по «;» оставила бы его
      # висеть отдельно.
      #
      # Многострочную директиву это погасило бы наполовину. Сегодня
      # таких в стандартном файле нет; появятся — поймает проба,
      # которая гоняется до подмены живой конфигурации.
      sed -i -E "s|^([[:space:]]*)(${d}[[:space:]].*)$|\1${NEIRO_METKA}\n\1# \2|" "$f"
      pogasheno+=("$d")
    fi
  done
  if [ ${#pogasheno[@]} -gt 0 ]; then
    printf '   ok   в стандартном nginx.conf погашено: %s\n' "${pogasheno[*]}"
  else
    printf '   ok   в стандартном nginx.conf гасить нечего — уже сделано\n'
  fi
}

# Разложить наши файлы в переданный корень (реальный /etc/nginx или
# пробное дерево). Ничего не проверяет и не перезагружает.
#
#   $1 — корень nginx (куда класть)
#   $2 — какой файл сайта брать из репозитория
#   $3 — корень клона репозитория
neiro_razlozhit() {
  local koren="$1" sayt="$2" repo="$3"
  install -d -m 755 "$koren/snippets" "$koren/conf.d" \
                    "$koren/sites-available" "$koren/sites-enabled"

  cp "$repo/deploy/nginx/snippets/neirolavka-static.conf"    "$koren/snippets/"
  cp "$repo/deploy/nginx/snippets/neirolavka-zagolovki.conf" "$koren/snippets/"
  cp "$repo/deploy/nginx/snippets/neirolavka-tls.conf"       "$koren/snippets/"
  cp "$repo/deploy/nginx/snippets/neirolavka-bot.conf"       "$koren/snippets/"
  cp "$repo/deploy/nginx/conf.d-neirolavka-obshchee.conf"    "$koren/conf.d/neirolavka-obshchee.conf"
  # Прежнее имя файла. Пока оно лежит рядом, gzip объявлен дважды уже
  # в нашей же настройке — надо убрать, а не надеяться, что не помешает.
  rm -f "$koren/conf.d/neirolavka-szhatie.conf"

  cp "$repo/deploy/nginx/$sayt" "$koren/sites-available/neirolavka.conf"

  # HTTP/2 объявляется по-разному до и после nginx 1.25.1: раньше
  # параметром listen, потом отдельной директивой. Пишем то, что
  # понимает установленная версия, иначе конфигурация не загрузится.
  if neiro_starshe "$NEIRO_NGINX_V" "1.25.1"; then
    sed -i 's/^\(\s*\)listen 443 ssl\(.*\);$/\1listen 443 ssl http2\2;/' \
      "$koren/sites-available/neirolavka.conf"
    printf '# http2 включается параметром listen: nginx %s\n' "$NEIRO_NGINX_V" \
      > "$koren/snippets/neirolavka-http2.conf"
    if grep -q '^listen \[::\]:443 ssl;$' "$koren/snippets/neirolavka-listen6-443.conf" 2>/dev/null; then
      sed -i 's/^listen \[::\]:443 ssl;$/listen [::]:443 ssl http2;/' \
        "$koren/snippets/neirolavka-listen6-443.conf"
    fi
  else
    printf 'http2 on;\n' > "$koren/snippets/neirolavka-http2.conf"
  fi

  # Симлинк, а не копия: правится один файл.
  ln -sfn "$koren/sites-available/neirolavka.conf" "$koren/sites-enabled/neirolavka.conf"
  rm -f "$koren/sites-enabled/default"
}

neiro_starshe() { [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -1)" = "$1" ] && [ "$1" != "$2" ]; }

# ПРОБА ДО ПОДМЕНЫ.
#
# Собирает полное дерево конфигурации во временной папке — стандартный
# nginx.conf с погашенными нашими директивами, живое содержимое conf.d,
# sites-enabled и snippets, поверх которого положены наши файлы, — и
# гоняет по нему nginx -t. Пути include переписываются на временное
# дерево, поэтому проверяется именно оно, а не то, что стоит сейчас.
#
# nginx -t сокетов не занимает (проверено: тест проходит, пока живой
# nginx слушает тот же порт), поэтому пробе можно объявлять настоящие
# 80 и 443.
#
# Возвращает 0, если конфигурация валидна. Ничего в /etc/nginx
# не трогает вовсе.
neiro_proba() {
  local sayt="$1" repo="$2"
  local T; T="$(mktemp -d)"
  # Живое состояние, симлинки разворачиваем в файлы.
  cp -rL /etc/nginx/conf.d/.       "$T/conf.d/"        2>/dev/null || install -d "$T/conf.d"
  cp -rL /etc/nginx/sites-enabled/. "$T/sites-enabled/" 2>/dev/null || install -d "$T/sites-enabled"
  cp -rL /etc/nginx/snippets/.     "$T/snippets/"      2>/dev/null || install -d "$T/snippets"
  install -d "$T/sites-available"
  # Сниппеты listen6 берём готовыми: их пишет вызывающий скрипт
  # по фактическому наличию адреса IPv6.
  cp -f /etc/nginx/snippets/neirolavka-listen6-*.conf "$T/snippets/" 2>/dev/null || true

  neiro_razlozhit "$T" "$sayt" "$repo" > /dev/null

  # Стандартный nginx.conf с погашенными нашими директивами.
  cp -a /etc/nginx/nginx.conf "$T/nginx.conf"
  neiro_pogasit_stock "$T/nginx.conf" > /dev/null
  # sites-enabled в пробе — обычный файл, а не симлинк наружу.
  rm -f "$T/sites-enabled/neirolavka.conf"
  cp "$T/sites-available/neirolavka.conf" "$T/sites-enabled/neirolavka.conf"

  # Переписываем пути включений на пробное дерево. mime.types
  # и modules-enabled оставляем настоящими — они не наши.
  local f
  for f in "$T/nginx.conf" "$T"/conf.d/*.conf "$T"/sites-enabled/* "$T"/snippets/*.conf; do
    [ -f "$f" ] || continue
    sed -i -e "s#/etc/nginx/conf\.d/#$T/conf.d/#g" \
           -e "s#/etc/nginx/sites-enabled/#$T/sites-enabled/#g" \
           -e "s#/etc/nginx/snippets/#$T/snippets/#g" "$f"
  done

  # Префикс НЕ подменяем. Стандартный nginx.conf грузит модули строкой
  # `load_module modules/…` — путь относительный, и разрешается он от
  # вкомпилированного префикса (/usr/share/nginx). Стоило передать
  # `-p /etc/nginx`, как проба начинала искать модули в /etc/nginx/modules
  # и падала на dlopen — то есть ругалась на то, чего в живой
  # конфигурации нет. Без -p проба видит ровно то же, что `nginx -t`.
  local vyhod=0
  if ! NEIRO_PROBA_VYVOD="$(nginx -t -c "$T/nginx.conf" 2>&1)"; then
    vyhod=1
  fi
  # Чистим за собой всегда: временная папка не должна пережить проверку.
  rm -rf "$T"
  return $vyhod
}

# Разложить по-настоящему: сначала проба, потом снимок, потом подмена,
# потом контрольная проверка с откатом. Перезагружает nginx только
# после того, как обе проверки прошли.
neiro_postavit() {
  local sayt="$1" repo="$2"

  printf '   ..   проба конфигурации во временном дереве\n'
  if ! neiro_proba "$sayt" "$repo"; then
    printf '   !!   проба НЕ прошла, живую конфигурацию не трогал:\n'
    printf '%s\n' "$NEIRO_PROBA_VYVOD" | sed 's/^/        /'
    return 1
  fi
  printf '   ok   проба прошла\n'

  # Снимок на случай, если живое дерево отличается от пробного чем-то,
  # чего проба не увидела. Проба ошибается редко, но откат стоит дёшево.
  local SNIMOK; SNIMOK="$(mktemp -d)"
  cp -a /etc/nginx "$SNIMOK/nginx"

  neiro_pogasit_stock /etc/nginx/nginx.conf
  neiro_razlozhit /etc/nginx "$sayt" "$repo"

  if ! nginx -t 2>&1 | sed 's/^/        /'; then
    printf '   !!   живая проверка не прошла — откатываюсь на снимок\n'
    rm -rf /etc/nginx
    cp -a "$SNIMOK/nginx" /etc/nginx
    nginx -t 2>&1 | sed 's/^/        /' || true
    rm -rf "$SNIMOK"
    return 1
  fi
  rm -rf "$SNIMOK"
  printf '   ok   живая конфигурация проходит nginx -t\n'
  return 0
}
