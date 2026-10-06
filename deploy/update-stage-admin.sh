#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Обновление админки ТЕСТОВОГО стенда (правка страницы «Сообщения»).
#
# Что делает:
#   1) применяет правку подвала ответа: подпись слева одной строкой,
#      кнопка «Отправить ответ» — справа (идемпотентно);
#   2) пересобирает стенд (серверный код + админка), сохраняя картинки из админки;
#   3) перезапускает службу стенда и проверяет, что админка отвечает.
#
# Боевой магазин НЕ трогается: путь и служба у стенда свои.
# Запуск на сервере:  bash /root/update-stage-admin.sh
# ---------------------------------------------------------------------------
set -euo pipefail

STAGE=/srv/narazborku/stage
APP=$STAGE/app/apps/backend
PAGE=$APP/src/admin/routes/messages/page.tsx
SERVICE=narazborku-stage

[ -f "$PAGE" ] || { echo "не найден файл страницы: $PAGE"; exit 1; }

echo "=== 1. правка страницы «Сообщения» ==="
sudo -u medusa python3 - "$PAGE" <<'PY'
import io, sys
p = sys.argv[1]
s = io.open(p, encoding="utf-8").read()
OLD = """                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <Button size="small" onClick={send} disabled={busy || !reply.trim()}>
                    Отправить ответ
                  </Button>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    Ответ появится в личном кабинете покупателя в разделе «Сообщения».
                  </Text>
                </div>"""
NEW = """                {/* подпись слева одной строкой, кнопка — справа (на узком экране кнопка переносится, но остаётся справа) */}
                <div style={{ display: "flex", gap: 12, rowGap: 8, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                  <span
                    className="text-ui-fg-subtle"
                    style={{ flex: "1 1 auto", minWidth: 0, fontSize: 12, lineHeight: 1.2, whiteSpace: "nowrap" }}
                  >
                    Ответ появится в личном кабинете покупателя в разделе «Сообщения».
                  </span>
                  <Button size="small" style={{ flex: "none", marginLeft: "auto" }} onClick={send} disabled={busy || !reply.trim()}>
                    Отправить ответ
                  </Button>
                </div>"""
if "marginLeft: \"auto\"" in s and "whiteSpace: \"nowrap\"" in s:
    print("  уже применено — файл не изменён")
elif OLD in s:
    io.open(p, "w", encoding="utf-8").write(s.replace(OLD, NEW, 1))
    print("  ✔ подпись слева, кнопка «Отправить ответ» справа")
else:
    print("  ! ожидаемый фрагмент не найден — правку нужно проверить руками")
    raise SystemExit(2)
PY

echo
echo "=== 2. пересборка стенда (серверный код + админка) ==="
STATIC_KEEP=$STAGE/.static-keep
rm -rf "$STATIC_KEEP"
if [ -d "$APP/.medusa/server/static" ]; then
  cp -a "$APP/.medusa/server/static" "$STATIC_KEEP"
  echo "картинок из админки сохранено: $(ls "$STATIC_KEEP" | wc -l)"
fi
sudo -u medusa -H env NODE_ENV=production NODE_OPTIONS="--max-old-space-size=1536" \
  bash -lc "cd $APP && npm run build" 2>&1 | tail -20
if [ -d "$STATIC_KEEP" ]; then
  mkdir -p "$APP/.medusa/server/static"
  cp -an "$STATIC_KEEP/." "$APP/.medusa/server/static/" 2>/dev/null || true
  chown -R medusa:medusa "$APP/.medusa/server/static" 2>/dev/null || true
  echo "картинок возвращено: $(ls "$APP/.medusa/server/static" | wc -l)"
fi

echo
echo "=== 3. перезапуск стенда ==="
systemctl restart "$SERVICE"
sleep 6
systemctl --no-pager --lines=3 status "$SERVICE" | head -8 || true
echo
echo "проверка адресов:"
curl -s -o /dev/null -w "  https://test.77-233-221-183.sslip.io/health → %{http_code}\n" https://test.77-233-221-183.sslip.io/health
curl -s -o /dev/null -w "  админка /app → %{http_code}\n" https://test.77-233-221-183.sslip.io/app
echo
echo "готово. Боевой магазин не трогали."
