#!/bin/bash
# ---------------------------------------------------------------------------
# Авто-включение магазина на поддомене shop.finklass.online.
#
# Следит за появлением DNS-записи и, как только она появится, сам запускает
# настройку (nginx + сертификат + адреса магазина). Проверка — раз в минуту.
#
# Запуск на сервере:  nohup bash /root/watch-subdomain.sh > /root/subdomain-watch.log 2>&1 &
# Журнал:             tail -f /root/subdomain-watch.log
# ---------------------------------------------------------------------------
DOMAIN=shop.finklass.online
IP=77.233.221.183
DEADLINE=$(( $(date +%s) + 21600 ))   # следим 6 часов

echo "$(date '+%F %T') следим за появлением $DOMAIN → $IP"
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  GOT=$(getent hosts $DOMAIN | awk '{print $1}' | head -1)
  if [ "$GOT" = "$IP" ]; then
    echo "$(date '+%F %T') ✔ запись появилась ($GOT) — включаю магазин на домене"
    bash /root/enable-shop-subdomain.sh 2>&1 | sed 's/^/    /'
    echo "$(date '+%F %T') работа завершена"
    exit 0
  fi
  echo "$(date '+%F %T') записи пока нет (${GOT:-нет})"
  sleep 60
done
echo "$(date '+%F %T') истекли 6 часов ожидания — запустите вручную: bash /root/enable-shop-subdomain.sh"
