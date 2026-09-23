# Установка и запуск

Приложение локальное: backend на Python запускается на вашем компьютере, интерфейс открывается в браузере по адресу
`http://127.0.0.1:8765`. Наружу ничего не публикуется, в Jira ходит только backend.

## Требования

| Компонент | Версия | Зачем |
|---|---|---|
| Python | 3.10 или новее | backend |
| Node.js | 22.12 или новее (LTS 22 или 24) | только для сборки интерфейса при первом запуске и после обновлений |
| Git | любая | скачать и обновлять код (можно обойтись ZIP-архивом) |
| Браузер | Chrome, Edge, Firefox, Safari последних версий | интерфейс |

Первый запуск скачивает зависимости из PyPI и npm, поэтому нужен интернет (или корпоративные зеркала, см.
[Проблемы](#проблемы)). Дальше приложению нужен только доступ к Jira.

## Скачать код

```bash
git clone -b claude/jira-time-tracking-reports-jcybv8 https://github.com/hexonxons/jira-timetracker.git
cd jira-timetracker
```

Когда ветка будет влита в основную, `-b ...` можно убрать. Без Git: на GitHub выберите ветку →
**Code → Download ZIP** и распакуйте архив.

---

## Windows 10 / 11

### 1. Установить Python, Node.js и Git

Проще всего через `winget` (встроен в Windows 10 1809+ и Windows 11). Откройте **PowerShell** и выполните:

```powershell
winget install -e --id Python.Python.3.12
winget install -e --id OpenJS.NodeJS.LTS
winget install -e --id Git.Git
```

Или вручную:

- Python: <https://www.python.org/downloads/windows/>. В установщике отметьте **Add python.exe to PATH**.
- Node.js: <https://nodejs.org/> → LTS (22.x или 24.x).
- Git: <https://git-scm.com/download/win>.

После установки **закройте и заново откройте** PowerShell, чтобы обновился `PATH`, и проверьте:

```powershell
py --version      # Python 3.10+  (или: python --version)
node --version    # v22.12+ 
```

### 2. Запустить

Двойной клик по **`run.cmd`** в папке проекта. Или из PowerShell:

```powershell
cd jira-timetracker
.\run.cmd
```

Первый запуск занимает 1–3 минуты: создаётся `backend\.venv`, ставятся зависимости, собирается интерфейс. Потом
откроется браузер. Окно консоли не закрывайте: это и есть работающее приложение. Остановка — `Ctrl+C` или закрыть окно.

Если хотите запускать `run.ps1` напрямую, а PowerShell пишет *running scripts is disabled on this system*, либо
используйте `run.cmd` (он обходит это ограничение только для себя), либо один раз разрешите локальные скрипты:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Настройки хранятся в `%USERPROFILE%\.jira-timetracker\settings.json`.

---

## macOS (12 Monterey и новее, Intel и Apple Silicon)

### 1. Установить Python, Node.js и Git

Через [Homebrew](https://brew.sh/):

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"   # если brew ещё нет
brew install python@3.12 node@22 git
brew link --overwrite node@22
```

Или установщиками с <https://www.python.org/downloads/macos/> и <https://nodejs.org/>. Git появится вместе с
Xcode Command Line Tools (`xcode-select --install`).

Проверка:

```bash
python3 --version   # 3.10+
node --version      # v22.12+
```

Системный `python3` из Command Line Tools бывает версии 3.9 — он не подойдёт. Если `python3 --version` показывает
3.9, запустите с явным путём: `PYTHON=python3.12 ./run.sh`.

### 2. Запустить

```bash
cd jira-timetracker
./run.sh
```

Откроется браузер. Остановка — `Ctrl+C` в терминале.

Настройки хранятся в `~/.jira-timetracker/settings.json`.

---

## Ubuntu (22.04 / 24.04) и другие Debian-подобные

### 1. Установить Python и Git

```bash
sudo apt update
sudo apt install -y python3 python3-venv git curl ca-certificates
python3 --version   # 22.04: 3.10, 24.04: 3.12 — обе подходят
```

### 2. Установить Node.js 22

Node.js из стандартного `apt` слишком старый (12 в 22.04, 18 в 24.04). Поставьте LTS из репозитория NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version      # v22.12+
```

Альтернатива без `sudo` — [nvm](https://github.com/nvm-sh/nvm): `nvm install 22`.

### 3. Запустить

```bash
cd jira-timetracker
./run.sh
```

Если браузер не открылся сам (например, на сервере без графики), откройте `http://127.0.0.1:8765` вручную.
Остановка — `Ctrl+C`.

Настройки хранятся в `~/.jira-timetracker/settings.json`.

---

## Первая настройка (все ОС)

1. Откройте вкладку **Settings**.
2. **Jira URL** — адрес Jira, например `https://jira.company.com`.
3. **Personal Access Token** — в Jira: аватар → **Profile → Personal Access Tokens → Create token**. Вставьте его
   и нажмите **Save**. Повторно вводить не нужно.
4. **SD Track field name** — оставьте `SD Track`, если поле в Jira называется так.
5. Нажмите **Test connection**. Должно появиться «Connected as …» и ID поля SD Track.
6. **Upload JSON…** — загрузите конфигурацию команд:

   ```json
   { "teams": [ { "name": "Sensors", "users": ["user4", "user5"] } ] }
   ```

   В `users` — Jira username (логин), а не отображаемое имя. Пример: `devtools/sample-teams.json`.
7. Перейдите на любую страницу отчёта, выберите период и нажмите **Generate**.

## Параметры запуска

```text
run.sh / run.cmd [--port 8765] [--no-browser]
```

- `--port` — другой порт, если 8765 занят.
- `--no-browser` — не открывать браузер автоматически.
- Переменная окружения `JTT_HOME` — другой каталог для `settings.json`.

## Обновление

```bash
git pull
./run.sh          # Windows: run.cmd
```

Интерфейс пересоберётся автоматически, если изменились его исходники. Если изменились Python-зависимости
(`backend/pyproject.toml`), удалите `backend/.venv` — при запуске окружение создастся заново.

## Проблемы

**Ошибка сертификата при подключении к Jira** (`CERTIFICATE_VERIFY_FAILED`). Приложение доверяет сертификатам,
установленным в систему (хранилище Windows, связка ключей macOS, `ca-certificates` в Ubuntu). Если корпоративный
корневой сертификат в систему не установлен, либо установите его, либо укажите путь к нему (PEM) в поле **CA bundle**
в Settings. В Ubuntu установка в систему:

```bash
sudo cp corp-root-ca.crt /usr/local/share/ca-certificates/ && sudo update-ca-certificates
```

**`pip` или `npm` не могут скачать пакеты** в корпоративной сети. Настройте прокси и сертификат для них:

```bash
# pip
python -m pip config set global.proxy http://proxy.company.com:3128
python -m pip config set global.cert /path/to/corp-root-ca.pem
# npm
npm config set proxy http://proxy.company.com:3128
npm config set https-proxy http://proxy.company.com:3128
npm config set cafile /path/to/corp-root-ca.pem
```

**`Node.js 22.12+ is required`** — установлена старая версия Node.js; обновите по инструкции для своей ОС.

**`python3-venv` / `ensurepip is not available`** (Ubuntu) — `sudo apt install python3-venv`, затем удалите
`backend/.venv` и запустите снова.

**Порт занят** (`address already in use`) — запустите с `--port 8780`.

**`401 Unauthorized`** в Test connection — токен неверный или истёк; создайте новый и сохраните в Settings.

**Отчёт пишет «User "…" was not found in Jira»** — в конфигурации указан не тот username; сверьте с полем
**Username** в профиле пользователя Jira.
