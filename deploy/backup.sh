#!/bin/sh
# Автобэкап: раз в BACKUP_INTERVAL_HOURS часов дамп базы (pg_dump, custom) и архив постеров в /backups.
# Хранятся последние BACKUP_KEEP копий каждого вида. Если копия не удалась, старые не трогаются.
set -u
INTERVAL=$(( ${BACKUP_INTERVAL_HOURS:-24} * 3600 ))
KEEP=${BACKUP_KEEP:-14}

while true; do
  stamp=$(date +%Y%m%d_%H%M%S)
  if pg_dump -h db -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f "/backups/episodio_$stamp.dump.part"; then
    mv "/backups/episodio_$stamp.dump.part" "/backups/episodio_$stamp.dump"
    ls -1t /backups/episodio_*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
    echo "backup: episodio_$stamp.dump"
  else
    rm -f "/backups/episodio_$stamp.dump.part"
    echo "backup: ОШИБКА pg_dump" >&2
  fi
  if tar -czf "/backups/posters_$stamp.tar.gz.part" -C /posters . 2>/dev/null; then
    mv "/backups/posters_$stamp.tar.gz.part" "/backups/posters_$stamp.tar.gz"
    ls -1t /backups/posters_*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
  else
    rm -f "/backups/posters_$stamp.tar.gz.part"
  fi
  sleep "$INTERVAL"
done
