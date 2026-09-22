# VPS: один сервер игры

Конфигурация рассчитана на Ubuntu, Docker Compose и Nginx на хосте. Репозиторий и образ не содержат паролей или текущих сессий. Запускается одна реплика приложения, поскольку партия использует SQLite и очередь команд в памяти.

## Каталоги и запуск

- Исходники: `/opt/stream-quiz`.
- Приватные переменные: `/etc/stream-quiz.env`, права `600`: `HOST_PASSWORD`, `PLAYER_PASSWORD`, `SESSION_SECRET` (не менее 32 случайных символов).
- Постоянные каталоги: `/srv/stream-quiz/data`, `/srv/stream-quiz/uploads`, `/srv/stream-quiz/backups`; владелец UID/GID `1000:1000`, соответствующий пользователю `node` в образе.

После установки Docker из официального репозитория и подготовки каталогов:

```sh
cd /opt/stream-quiz
docker compose -f deploy/compose.yml up -d --build
docker compose -f deploy/compose.yml ps
curl --fail http://127.0.0.1:3001/api/health
```

Приложение слушает только `127.0.0.1:3001` на хосте. Публичные порты — 80 и 443 у Nginx. Данные остаются вне каталога исходников при обновлении образа. На пустой базе импортируется опубликованная библиотека вопросов; существующая база не заменяется.

## HTTPS на публичном IP

Let's Encrypt выдаёт сертификаты для IP через профиль `shortlived`; Certbot 5.4+ поддерживает проверку через webroot. До первого выпуска нужен HTTP-блок Nginx, который обслуживает `/.well-known/acme-challenge/` из `/var/lib/letsencrypt` на порту 80. SSL-блок включается после получения сертификата.

Пример первого выпуска (замените адрес на свой):

```sh
docker run --rm \
  -v /etc/letsencrypt:/etc/letsencrypt \
  -v /var/lib/letsencrypt:/var/lib/letsencrypt \
  certbot/certbot:v5.8.0 certonly \
  --non-interactive --agree-tos --register-unsafely-without-email \
  --preferred-profile shortlived \
  --webroot --webroot-path /var/lib/letsencrypt \
  --ip-address PUBLIC_IP --cert-name stream-quiz
```

В `nginx.conf.template` замените `__PUBLIC_HOST__` на публичный IP, поместите результат в `/etc/nginx/conf.d/stream-quiz.conf`, проверьте `nginx -t` и перезагрузите конфигурацию. Сохраните существующие сайты сервера; конфликтующие слушатели портов нужно проверить перед установкой.

Скопируйте `stream-quiz-cert-renew.service` и `.timer` в `/etc/systemd/system/`, затем:

```sh
systemctl daemon-reload
systemctl enable --now stream-quiz-cert-renew.timer
systemctl list-timers stream-quiz-cert-renew.timer
```

Таймер дважды в день проверяет необходимость обновления короткого сертификата, после успешной команды перезагружает Nginx. Сертификаты сохраняются в `/etc/letsencrypt`.

## Проверка после установки

Проверьте публичные `/api/health`, `/host` и `/play`, авторизацию и соединение Socket.IO через HTTPS; недоступность редактора без входа; загрузку вопроса и медиа. После перезапуска контейнера должны сохраниться вопросы, файлы и состояние партии. Ссылки ведущего и игроков отличаются только `/host` и `/play`.

Документация: [Docker на Ubuntu](https://docs.docker.com/engine/install/ubuntu/), [сертификаты для IP](https://letsencrypt.org/2026/03/11/shorter-certs-certbot/).
