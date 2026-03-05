# Settings GUI Builder Backend API

Этот проект — микросервис на Node.js, который компилирует C++ код из `Settings GUI Builder` прямо на сервере (например, VPS на Ubuntu) с помощью PlatformIO, чтобы возвращать готовые `.bin` прошивки браузеру.

## Контекст для ИИ (AI Context)
**Что делает этот проект:**
1. Принимает POST-запрос с ZIP-архивом (содержащим `platformio.ini` и папку `src/main.cpp`).
2. Принимает параметр `board` (окружение PlatformIO, например `esp32-c3-devkitm-1`).
3. Распаковывает архив во временную папку.
4. Запускает `pio run -e <board>` в этой папке.
5. Возвращает получившийся `firmware.bin` как ответ на запрос.
6. Очищает временные файлы.

**Технологии:**
- Node.js
- Express
- Multer (для приема файлов)
- PlatformIO Core (предполагается, что установлен на сервере)

## Инструкция по установке на Ubuntu 24.04 (VPS)

### 1. Подготовка сервера
Убедитесь, что установлены Node.js, Python и PlatformIO:
```bash
sudo apt update
sudo apt install -y nodejs npm python3-venv unzip

# Установка PlatformIO
python3 -c "$(curl -fsSL https://raw.githubusercontent.com/platformio/platformio/master/scripts/get-platformio.py)"

# Добавление pio в PATH (перезагрузите терминал после этого)
echo "export PATH=\$PATH:\$HOME/.platformio/penv/bin" >> ~/.bashrc
source ~/.bashrc
```

### 2. Запуск проекта
Склонируйте конфигурацию и установите зависимости:
```bash
git clone <ваш-репозиторий>
cd settings-gui-builder-backend

# Инициализация (если package.json пуст)
npm init -y
npm install express cors multer

# Запуск сервера
node server.js
```

## Базовый код `server.js` (Отправная точка)
Для нового диалога с ИИ, скопируйте этот код в `server.js`.
Он уже содержит базовую логику распаковки, сборки и отправки файла:

```javascript
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');

const execAsync = util.promisify(exec);
const app = express();
const upload = multer({ dest: 'uploads/' });

// Настройки CORS (разрешить запросы с нашего фронтенда Vercel)
app.use(cors({ origin: '*' }));
app.use(express.json());

app.post('/compile', upload.single('projectZip'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).send('No zip provided');

        const zipPath = req.file.path;
        const workDir = path.join(__dirname, 'builds', \`build_\${Date.now()}\`);
        const envName = req.body.board || 'esp32-c3-devkitm-1'; // Дефолт при отсутствии

        // 1. Создаем рабочую папку
        fs.mkdirSync(workDir, { recursive: true });

        // 2. Распаковка ZIP
        console.log(\`Unzipping \${zipPath} to \${workDir}...\`);
        await execAsync(\`unzip \${zipPath} -d \${workDir}\`);

        // 3. Запускаем компиляцию PlatformIO
        console.log(\`Starting compilation for \${envName}...\`);
        // Убрали таймауты, так как первая скачка либ может быть долгой
        await execAsync(\`pio run -e \${envName}\`, { cwd: workDir });

        // 4. Ищем готовый .bin файл
        const binPath = path.join(workDir, '.pio', 'build', envName, 'firmware.bin');
        if (!fs.existsSync(binPath)) {
            throw new Error('Firmware binary not found after compilation.');
        }

        // 5. Отправляем файл пользователю
        res.download(binPath, 'firmware.bin', (err) => {
            // 6. Очистка после отправки
            fs.rmSync(workDir, { recursive: true, force: true });
            fs.unlinkSync(zipPath);
        });

    } catch (error) {
        console.error('Compilation error:', error);
        res.status(500).send(\`Compilation failed: \${error.message}\`);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(\`PIO Compile Server running on port \${PORT}\`);
});
```

## Дальнейшие шаги (Для ИИ в новом окне)
1. Настроить конфигурацию HTTPS (например, NGINX Reverse Proxy + Certbot), так как **Web Serial API работает только с HTTPS**.
2. Внедрить ограничитель скорости запросов (`express-rate-limit`), чтобы VPS не "положили" спамом компиляций.
3. Добавить стриминг логов компиляции через WebSocket (если захочется сделать красиво на фронте).
