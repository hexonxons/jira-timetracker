# Jira Time Reports

Веб-сервис для Tempo-подобных отчётов по списанному времени в Jira Data Center. Разворачивается одним
Docker-контейнером в облаке или на внутреннем сервере; пользователи работают через браузер.

Команда сотрудника берётся **только** из JSON-конфигурации команд, работа классифицируется по полю **SD Track**
(Jira Components не используются). Любая цифра раскрывается кликом до сотрудников, задач и отдельных worklogs.

## Отчёты

| Страница | Строки | Клик по ячейке |
|---|---|---|
| People / Issues | Team → Employee → Issue | задачи и worklogs за день |
| People / Tracks | Team → Employee → SD Track → Issue | задачи и worklogs |
| Teams / Tracks | Team → SD Track → Employee → Issue | сотрудники → задачи → worklogs |
| Summary | матрица Team × SD Track и итоги по трекам; Hours / Person-days | по дням или по сотрудникам → задачи → worklogs |

- Колонки — дни периода (до 31 дня). Суббота и воскресенье скрыты, но появляются (затенёнными), если в них есть
  списанное время.
- Время показывается как `7h 30m`, пустые ячейки пустые. Человеко-дни = часы / часы в человеко-дне (по умолчанию 8).
- Все сотрудники из конфигурации видны, даже без worklogs. Задачи без SD Track попадают в `<no SD Track>`.
- SD Track берётся по **текущему** значению задачи; дата worklog — дата его `started` в таймзоне владельца PAT.
- Отчёт строится только целиком: если конфигурация некорректна, пользователь не найден в Jira или часть данных не
  загрузилась, выводится список ошибок.

## Развёртывание

Jira URL и общий Personal Access Token задаются конфигурацией инстанса (переменными окружения). Конфигурацию
команд по умолчанию задаёт администратор; каждый пользователь может загрузить свою — она хранится в его браузере.

```bash
docker build -t jira-timetracker .
docker run -p 8080:8080 -e JTT_JIRA_URL=https://jira.company.com -e JTT_JIRA_PAT=... jira-timetracker
```

Подробно — сборка за корпоративным прокси, все переменные, Docker Compose, Kubernetes, требования к облачной
платформе и безопасность: [docs/DEPLOY.md](docs/DEPLOY.md).

## Как загружаются данные

1. `GET /rest/api/2/myself`, поиск поля SD Track по имени, `GET /rest/api/2/user` для каждого пользователя из
   конфигурации.
2. `POST /rest/api/2/search` с JQL `worklogAuthor in (...) AND worklogDate >= ... AND worklogDate <= ...`
   (пользователи пачками по 50, постранично).
3. `GET /rest/api/2/issue/{key}/worklog` для каждой найденной задачи (до 8 параллельно, постранично), затем отбор
   по автору из конфигурации и дате периода.
4. На 429/502/503/504 и сетевые ошибки — повтор с учётом `Retry-After` или экспоненциальной паузой (до 6 попыток).

Backend (`backend/jtt`) отдаёт плоский датасет, все агрегации считает frontend (`frontend/src/lib/aggregate.ts`),
поэтому все отчёты строятся из одних и тех же чисел.

## Разработка

Нужны Python 3.10+ и Node.js 22.12+.

```bash
# backend: тесты
cd backend && python3 -m venv .venv && .venv/bin/pip install -e '.[dev]' && .venv/bin/pytest
# frontend: тесты и сборка
cd frontend && npm ci && npm test && npm run build

# фейковая Jira DC со сгенерированными данными на http://127.0.0.1:8900 (любой PAT)
backend/.venv/bin/python devtools/fake_jira.py
# сервис против неё на http://127.0.0.1:8080 (отдаёт frontend/dist)
JTT_JIRA_URL=http://127.0.0.1:8900 JTT_JIRA_PAT=any JTT_TEAMS_FILE=devtools/sample-teams.json \
  backend/.venv/bin/python -m jtt
# frontend с hot reload на :5173 (проксирует /api на :8080)
cd frontend && npm run dev
```
