# Развёртывание как сервиса

Сервис — один Docker-контейнер: backend на Python отдаёт API и собранный интерфейс на порту `8080`. В Jira он
ходит от имени **одного общего Personal Access Token**, который задаётся конфигурацией инстанса. Авторизации
пользователей пока нет.

```
браузеры ──HTTP──▶ контейнер jira-timetracker :8080 ──HTTPS + общий PAT──▶ Jira Data Center
```

## Прежде чем открывать доступ

- **Нет авторизации.** Любой, кто может открыть адрес сервиса, видит всё, что видит владелец PAT: списанное время,
  задачи и комментарии к worklogs. Публикуйте сервис только во внутренней сети или VPN, либо поставьте перед ним
  прокси с корпоративным SSO (oauth2-proxy, auth в ingress-контроллере, Identity-Aware Proxy облака).
- **Токен не покидает сервер.** В браузер уходит только признак «токен задан». Менять настройки из браузера
  нельзя: API для этого просто нет. Иначе любой посетитель мог бы подменить URL Jira и увести токен.
- **Технический пользователь.** Выпустите PAT для отдельной учётной записи Jira с правом только на чтение нужных
  проектов. Отчёт покажет ровно то, что видит этот пользователь. **Таймзона в его профиле** определяет, к какому
  дню относится worklog.
- **Сетевой доступ к Jira.** Контейнер должен достучаться до Jira. Если Jira во внутренней сети, а сервис — в
  облаке, нужен VPN или interconnect между ними.

## Сборка образа

```bash
docker build -t jira-timetracker:latest .
```

Образ многоступенчатый: интерфейс собирается в `node:22-alpine`, в итоговый образ на `python:3.12-slim` (~200 МБ)
попадают только backend и собранная статика. Процесс работает от непривилегированного пользователя `10001` и не
пишет на диск, поэтому корневую файловую систему можно смонтировать только для чтения.

За корпоративным прокси, который подменяет TLS-сертификаты, передайте его CA на время сборки. В образ он не
попадает:

```bash
docker build \
  --build-arg HTTPS_PROXY=http://proxy.company.com:3128 \
  --secret id=ca_bundle,src=corp-root-ca.pem \
  -t jira-timetracker:latest .
```

### Сборка падает на скачивании пакетов

Во время сборки скачиваются пакеты npm (`registry.npmjs.org`) и PyPI (`pypi.org`). Если сборочный контейнер
не может до них достучаться, ошибка выглядит так:

- `Temporary failure in name resolution` / `Could not find a version that satisfies the requirement setuptools` —
  внутри сборки не работает DNS (часто при VPN или корпоративном DNS, который Docker не передаёт в контейнеры);
- `CERTIFICATE_VERIFY_FAILED` / `self-signed certificate in certificate chain` — прокси подменяет TLS-сертификаты;
- `The handshake operation timed out` / `Read timed out` при том, что `curl https://pypi.org` с хоста работает —
  межсетевой экран не пропускает «большой» TLS-handshake. OpenSSL 3.5 (Debian 13, Node 22) добавляет в него
  постквантовый ключ, и первый пакет вырастает до ~1.5 КБ. Образ уже отключает это через
  `docker/tls-compat.cnf` (и при сборке, и для работы сервиса); если у вас образ старше — обновите код;
- таймауты — в интернет можно только через прокси.

Проверить, что видит контейнер: `docker run --rm python:3.12-slim python -c "import socket; print(socket.gethostbyname('pypi.org'))"`.

Варианты, по возрастанию усилий:

```bash
# 1. Использовать сеть и DNS хоста (Linux; самый частый случай с VPN)
docker build --network host -t jira-timetracker .

# 2. Ходить через HTTP-прокси (и, если он подменяет TLS, доверять его CA)
docker build --network host \
  --build-arg HTTPS_PROXY=http://proxy.company.com:3128 \
  --secret id=ca_bundle,src=corp-root-ca.pem \
  -t jira-timetracker .

# 3. Качать пакеты из внутренних зеркал (Nexus, Artifactory) вместо интернета
docker build \
  --build-arg PIP_INDEX_URL=https://nexus.company.com/repository/pypi/simple \
  --build-arg NPM_CONFIG_REGISTRY=https://nexus.company.com/repository/npm/ \
  -t jira-timetracker .
```

Если зеркало PyPI отдаётся по HTTP или с самоподписанным сертификатом, добавьте
`--build-arg PIP_TRUSTED_HOST=nexus.company.com` (или передайте его CA через `--secret id=ca_bundle,...`).

Чтобы DNS работал во всех сборках без `--network host`, можно прописать корпоративные DNS-серверы Docker’у:
`/etc/docker/daemon.json` → `{"dns": ["10.0.0.53", "10.0.0.54"]}` и `sudo systemctl restart docker`
(в Docker Desktop — Settings → Docker Engine).

### Сборка на Windows (Docker Desktop)

Docker Desktop собирает образ внутри виртуальной машины WSL2, поэтому `sudo` не нужен, а `--network host`
даёт сеть этой ВМ, а не Windows. Запускайте сборку из PowerShell в папке проекта:

```powershell
docker build --no-cache -t jira-timetracker:1.0 .
```

Если npm пишет `SELF_SIGNED_CERT_IN_CHAIN` (или pip — `CERTIFICATE_VERIFY_FAILED`), HTTPS-трафик
перехватывает корпоративный прокси или антивирус. Windows доверяет его корневому сертификату, а контейнер —
нет. Выгрузите доверенные корневые сертификаты Windows в файл и передайте его в сборку (в образ он не попадает):

```powershell
$certs = Get-ChildItem Cert:\LocalMachine\Root, Cert:\CurrentUser\Root
$certs | ForEach-Object {
  "-----BEGIN CERTIFICATE-----`n" + [Convert]::ToBase64String($_.RawData, 'InsertLineBreaks') + "`n-----END CERTIFICATE-----"
} | Set-Content -Encoding ascii windows-roots.pem

docker build --no-cache --secret id=ca_bundle,src=windows-roots.pem -t jira-timetracker:1.0 .
```

Этот же перехват касается и работающего сервиса, если он будет ходить в Jira через ту же сеть: тогда
смонтируйте файл в контейнер и укажите `JTT_CA_BUNDLE` (см. таблицу переменных).

Если сборка зависает на `npm ci` (`npm error Exit handler never called!`) или pip падает по таймауту, а в
браузере Windows всё открывается, — сеть WSL2 не дружит с VPN или корпоративной сетью:

1. Включите «зеркальную» сеть WSL (Windows 11 22H2+): в `%UserProfile%\.wslconfig`
   ```ini
   [wsl2]
   networkingMode=mirrored
   ```
   затем `wsl --shutdown` и перезапуск Docker Desktop.
2. Либо уменьшите MTU Docker: Docker Desktop → Settings → Docker Engine → добавьте `"mtu": 1400` → Apply & restart.
3. Проверить сеть внутри Docker без сборки:
   ```powershell
   docker run --rm -v "${PWD}\frontend:/src:ro" node:22-alpine sh -c "mkdir /w && cp /src/package*.json /w && cd /w && npm ci --no-audit --no-fund --loglevel http"
   ```
   Последние строки покажут, на каком запросе всё встало.

Затем загрузите образ в реестр, из которого тянет ваша платформа:
`docker tag jira-timetracker:latest registry.company.com/jira-timetracker:1.0 && docker push ...`.

## Конфигурация инстанса

Все настройки задаются переменными окружения; из браузера их изменить нельзя.

| Переменная | Обязательна | Описание |
|---|---|---|
| `JTT_JIRA_URL` | да | Адрес Jira, например `https://jira.company.com` |
| `JTT_JIRA_PAT` | да, или `JTT_JIRA_PAT_FILE` | Общий Personal Access Token |
| `JTT_JIRA_PAT_FILE` |  | Путь к файлу с токеном (Docker/Kubernetes secret). Предпочтительнее, чем передавать токен переменной |
| `JTT_TEAMS_FILE` | нет | Путь к JSON конфигурации команд **по умолчанию**. Читается при каждом запросе, так что правки подхватываются без перезапуска |
| `JTT_TEAMS_JSON` | нет | То же, но JSON прямо в переменной |
| `JTT_SD_TRACK_FIELD_NAME` | нет | Имя поля SD Track в Jira, по умолчанию `SD Track` |
| `JTT_HOURS_PER_PERSON_DAY` | нет | Часов в человеко-дне, по умолчанию `8` |
| `JTT_CA_BUNDLE` | нет | PEM с корпоративным CA для подключения к Jira. Без него используется системное хранилище образа |
| `JTT_MAX_PARALLEL_REPORTS` | нет | Сколько отчётов одновременно загружаются из Jira, по умолчанию `3`. Остальные ждут в очереди |
| `JTT_REPORT_CACHE_SECONDS` | нет | Сколько секунд отдавать готовый отчёт повторно на идентичный запрос, по умолчанию `0` (каждый раз свежая загрузка) |
| `PORT` | нет | Порт HTTP, по умолчанию `8080` |

Ошибки конфигурации (нет токена, битый JSON команд, файл не найден) видны на `/healthz`, на странице Settings
и в самом отчёте. Сервис при этом стартует, чтобы их можно было увидеть.

### Конфигурация команд

- Если задан `JTT_TEAMS_FILE` или `JTT_TEAMS_JSON`, это конфигурация по умолчанию для всех пользователей.
- Любой пользователь может загрузить **свою** конфигурацию в Settings. Она хранится только в его браузере,
  уходит на сервер вместе с каждым запросом отчёта и больше нигде не сохраняется. Кнопка «Use instance default»
  возвращает конфигурацию по умолчанию.
- Если конфигурации по умолчанию нет, каждый пользователь загружает свою.

## Запуск

### Docker

```bash
docker run -d --name jira-timetracker --restart unless-stopped -p 8080:8080 --read-only \
  -e JTT_JIRA_URL=https://jira.company.com \
  -e JTT_JIRA_PAT_FILE=/secrets/jira-pat \
  -e JTT_TEAMS_FILE=/config/teams.json \
  -v /srv/jtt/jira-pat.txt:/secrets/jira-pat:ro \
  -v /srv/jtt/teams.json:/config/teams.json:ro \
  jira-timetracker:latest
```

Файл с токеном должен быть доступен на чтение пользователю `10001` внутри контейнера, например `chmod 644`.

### Docker Compose

Готовый пример — [`deploy/docker-compose.yml`](../deploy/docker-compose.yml):

```bash
cd deploy
printf '%s' 'ВАШ_PAT' > jira-pat.txt        # оба файла в .gitignore
cp ../devtools/sample-teams.json teams.json  # и отредактируйте
# поправьте JTT_JIRA_URL в docker-compose.yml
docker compose up -d --build
```

### Kubernetes

Пример манифеста — [`deploy/kubernetes.yaml`](../deploy/kubernetes.yaml): Secret с токеном, ConfigMap с командами,
Deployment, Service. Перед применением замените образ, URL Jira, токен и команды, затем:

```bash
kubectl apply -f deploy/kubernetes.yaml
```

Доступ снаружи настраивается через Ingress вашего кластера, вместе с аутентификацией (см. выше). Токен лучше
хранить во внешнем менеджере секретов (Vault, External Secrets, Sealed Secrets), а не в манифесте.

### Облачные платформы контейнеров

Подойдёт любая платформа, где работает обычный контейнер: виртуальная машина с Docker, managed Kubernetes,
App Service / Container Apps, ECS и т. п. Два требования:

1. **Ровно один экземпляр.** Загружаемые отчёты хранятся в памяти процесса. При двух экземплярах опрос готовности
   попадёт на другой экземпляр, и пользователь получит «Report not found». Ставьте `replicas: 1` или
   `max instances = 1`, при обновлении стратегию `Recreate`.
2. **CPU не только во время запроса.** Отчёт грузится в фоне между запросами браузера. На serverless-платформах,
   которые выделяют CPU только на время обработки запроса (например, Cloud Run по умолчанию), включите режим
   «CPU always allocated» (`--no-cpu-throttling`).

## Эксплуатация

- **Проверка здоровья:** `GET /healthz` → `{"status": "ok", "configErrors": []}`.
- **Логи:** access-лог uvicorn в stdout. Токен в логи не пишется.
- **Ресурсы:** ~40–60 МБ памяти в работе. Каждый загруженный отчёт держится в памяти 30 минут (до 50 отчётов);
  отчёт за месяц на 100 человек — единицы мегабайт. Лимита 1 ГБ хватает с запасом.
- **Нагрузка на Jira:** один отчёт делает до 8 параллельных запросов; одновременно грузится не больше
  `JTT_MAX_PARALLEL_REPORTS` отчётов. Одинаковые запросы, пришедшие во время загрузки, ждут ту же загрузку, а не
  запускают новую. На `429` Jira сервис ждёт `Retry-After` и повторяет.
- **Обновление:** соберите новый образ и перезапустите контейнер. Отчёты в памяти теряются, пользователи просто
  нажимают Generate ещё раз.

## Проверка без настоящей Jira

```bash
backend/.venv/bin/python devtools/fake_jira.py &          # фейковая Jira на 127.0.0.1:8900
docker run --rm --network host -e JTT_JIRA_URL=http://127.0.0.1:8900 -e JTT_JIRA_PAT=any \
  -e JTT_TEAMS_FILE=/config/teams.json -v $PWD/devtools/sample-teams.json:/config/teams.json:ro \
  jira-timetracker:latest
# http://127.0.0.1:8080
```

(`--network host` работает на Linux; в Docker Desktop укажите `JTT_JIRA_URL=http://host.docker.internal:8900` и
запустите фейковую Jira с `FAKE_JIRA_HOST=0.0.0.0`.)
