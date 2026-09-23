# Jira Time Reports

Локальное приложение для Tempo-подобных отчётов по списанному времени в Jira Data Center.

Команда сотрудника берётся **только** из JSON-конфигурации команд, работа классифицируется по полю **SD Track**
(Jira Components не используются). Любая цифра раскрывается кликом до сотрудников, задач и отдельных worklogs.

## Отчёты

| Страница | Строки | Клик по ячейке |
|---|---|---|
| People / Issues | Team → Employee → Issue | задачи и worklogs за день |
| People / Tracks | Team → Employee → SD Track → Issue | задачи и worklogs |
| Teams / Tracks | Team → SD Track → Employee → Issue | сотрудники → задачи → worklogs |
| Summary | Team × Track, Employee × Track, итоги по командам, сотрудникам и трекам; Hours / Person-days | по дням или по сотрудникам → задачи → worklogs |

- Колонки — дни периода. Суббота и воскресенье скрыты, но появляются (затенёнными), если в них есть списанное время.
- Время показывается как `7h 30m`, пустые ячейки пустые. Человеко-дни = часы / «Hours per person-day» (по умолчанию 8).
- Все сотрудники из конфигурации видны, даже без worklogs. Задачи без SD Track попадают в `<no SD Track>`.
- SD Track берётся по **текущему** значению задачи; дата worklog — дата его `started` в таймзоне владельца PAT.
- Отчёт строится только целиком: если конфигурация некорректна, пользователь не найден в Jira или часть данных не
  загрузилась, выводится список ошибок.

## Запуск

Нужны Python 3.10+ и Node.js 20+.

```bash
./run.sh            # собирает frontend при необходимости и открывает http://127.0.0.1:8765
```

Дальше в **Settings**:

1. Jira URL и Personal Access Token (сохраняются в `~/.jira-timetracker/settings.json`; каталог меняется через `JTT_HOME`).
2. Имя поля SD Track (по умолчанию `SD Track`, ищется по имени в `/rest/api/2/field`) и часы в человеко-дне.
3. При корпоративном сертификате — путь к CA bundle (PEM).
4. Загрузить JSON команд:

```json
{ "teams": [ { "name": "Sensors", "users": ["user4", "user5"] } ] }
```

Затем на любой странице отчёта выбрать период (до 31 дня) и нажать **Generate**.

## Как загружаются данные

1. `GET /rest/api/2/myself`, поиск поля SD Track, `GET /rest/api/2/user` для каждого пользователя из конфигурации.
2. `POST /rest/api/2/search` с JQL `worklogAuthor in (...) AND worklogDate >= ... AND worklogDate <= ...`
   (пользователи пачками по 50, постранично).
3. `GET /rest/api/2/issue/{key}/worklog` для каждой найденной задачи (до 8 параллельно, постранично), затем отбор
   по автору из конфигурации и дате периода.
4. На 429/502/503/504 и сетевые ошибки — повтор с учётом `Retry-After` или экспоненциальной паузой (до 6 попыток).

Backend (`backend/jtt`) отдаёт плоский датасет, все агрегации считает frontend (`frontend/src/lib/aggregate.ts`),
поэтому все отчёты строятся из одних и тех же чисел.

## Разработка

```bash
# backend
cd backend && python3 -m venv .venv && .venv/bin/pip install -e '.[dev]' && .venv/bin/pytest
# frontend
cd frontend && npm ci && npm test && npm run build

# фейковая Jira DC со сгенерированными данными: http://127.0.0.1:8900, любой PAT,
# конфигурация команд — devtools/sample-teams.json
backend/.venv/bin/python devtools/fake_jira.py
# frontend с hot reload (проксирует /api на backend :8765)
cd frontend && npm run dev
```
