#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Уборка тестовых диалогов продавца с покупателями (раздел «Сообщения»).
#
# Что делает:
#   1. показывает, сколько диалогов и сообщений сейчас;
#   2. сохраняет резервную копию обеих таблиц (данные можно вернуть);
#   3. убирает диалоги и сообщения из базы стенда;
#   4. показывает, что осталось, и что отвечает админский раздел «Сообщения».
#
# Работает ТОЛЬКО со стендом: база narazborku_stage, боевая не трогается.
# Товары, цены, наличие, баннеры и настройки не затрагиваются.
#
# Запуск на сервере:  bash /root/clean-test-messages.sh --yes
# Без --yes ничего не меняет — только показывает, что будет убрано.
# Бэкап: /var/backups/narazborku/stage-messages-<дата>.sql.gz
# ---------------------------------------------------------------------------
set -u

DB="${DB:-narazborku_stage}"
BASE="${BASE:-http://127.0.0.1:9001}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/narazborku}"

q() { sudo -u postgres psql -d "$DB" -tAc "$1"; }
report() {
  sudo -u postgres psql -d "$DB" -c "
  select (select count(*) from conversation) as диалогов,
         (select count(*) from message)      as сообщений,
         (select count(*) from conversation where deleted_at is not null) as мягко_удалённых;"
}

echo "== 1. что сейчас в базе «$DB» =="
report || { echo "   нет таблиц сообщений — возможно, уборка уже сделана"; exit 0; }

CONV=$(q "select count(*) from conversation")
MSG=$(q "select count(*) from message")
if [ "${CONV:-0}" = "0" ] && [ "${MSG:-0}" = "0" ]; then
  echo "   диалогов нет — база уже чистая"
  exit 0
fi

if [ "${1:-}" != "--yes" ]; then
  echo
  echo "   Диалогов: $CONV, сообщений: $MSG."
  echo "   Запустите с ключом --yes, чтобы убрать их (сначала будет сделана резервная копия)."
  exit 0
fi

echo
echo "== 2. резервная копия =="
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP_DIR"
FILE="$BACKUP_DIR/stage-messages-$TS.sql.gz"
sudo -u postgres pg_dump -d "$DB" --data-only --table=conversation --table=message 2>/dev/null | gzip > "$FILE"
if [ ! -s "$FILE" ]; then echo "   не удалось создать резервную копию — уборка отменена"; rm -f "$FILE"; exit 1; fi
echo "   $FILE ($(du -h "$FILE" | cut -f1))"
echo "   проверить содержимое:  zcat $FILE | head"

echo
echo "== 3. убираю диалоги и сообщения =="
sudo -u postgres psql -d "$DB" -q -c "begin; delete from message; delete from conversation; commit;"
echo "   готово"

echo
echo "== 4. что осталось =="
report

echo
echo "== 5. что показывает раздел «Сообщения» в админке =="
TOKEN=$(curl -s --max-time 20 -X POST "$BASE/auth/user/emailpass" -H 'Content-Type: application/json' \
  -d "{\"email\":\"prodjectmen@gmail.com\",\"password\":\"${ADMIN_PASS:-}\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
if [ -n "$TOKEN" ]; then
  curl -s --max-time 20 -H "Authorization: Bearer $TOKEN" "$BASE/admin/messages?filter=all&q=" \
    | python3 -c "import sys,json;d=json.load(sys.stdin);print('   диалогов:',len(d.get('conversations',[])),'| статистика:',d.get('stats'))"
else
  echo "   (не удалось войти в админку — проверьте раздел «Сообщения» вручную)"
fi

echo
echo "   Резервная копия: $FILE"
echo "   Боевой магазин не трогали."
