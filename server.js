const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');
const http = require('http');
const { WebSocketServer } = require('ws');
const rateLimit = require('express-rate-limit');

const execAsync = util.promisify(exec);
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const upload = multer({ dest: 'uploads/' });

// Настройки CORS (разрешить запросы с нашего фронтенда Vercel)
app.use(cors({ origin: '*' }));
app.use(express.json());

// Ограничитель скорости: максимум 10 запросов на компиляцию с одного IP в полчаса (зависит от мощности VPS)
const compileLimiter = rateLimit({
    windowMs: 30 * 60 * 1000, // 30 минут
    max: 10,
    message: 'Too many compilation requests from this IP, please try again after 30 minutes'
});

// Хранилище активных WebSocket подключений (buildId -> WebSocket)
const wsClients = new Map();

wss.on('connection', (ws, req) => {
    // Ожидаем подключение по URL вида: ws://server.com/?buildId=12345
    const url = new URL(req.url, `http://${req.headers.host}`);
    const buildId = url.searchParams.get('buildId');

    if (buildId) {
        wsClients.set(buildId, ws);
        ws.on('close', () => wsClients.delete(buildId));
        ws.send(JSON.stringify({ type: 'info', data: 'WebSocket connected. Waiting for logs...' }));
    } else {
        ws.close(1008, 'buildId is required');
    }
});

// Helper function to send log to ws
function sendLog(buildId, message) {
    const ws = wsClients.get(buildId);
    if (ws && ws.readyState === 1) { // OPEN
        ws.send(JSON.stringify({ type: 'log', data: message.toString() }));
    }
}

app.post('/compile', compileLimiter, upload.single('projectZip'), async (req, res) => {
    const buildId = req.body.buildId || `build_${Date.now()}`;
    const zipPath = req.file ? req.file.path : null;
    const workDir = path.join(__dirname, 'builds', buildId);

    try {
        if (!zipPath) return res.status(400).send('No zip provided');

        const envName = req.body.board || 'esp32-c3-devkitm-1'; // Дефолт при отсутствии

        // 1. Создаем рабочую папку
        fs.mkdirSync(workDir, { recursive: true });

        // 2. Распаковка ZIP
        sendLog(buildId, `Unzipping project to ${workDir}...`);
        console.log(`Unzipping ${zipPath} to ${workDir}...`);
        await execAsync(`unzip "${zipPath}" -d "${workDir}"`);

        // 3. Запускаем компиляцию PlatformIO
        sendLog(buildId, `Starting compilation for env: ${envName}...`);
        console.log(`Starting compilation for ${envName}...`);

        const pio = spawn('pio', ['run', '-e', envName], { cwd: workDir });

        pio.stdout.on('data', (data) => {
            sendLog(buildId, data.toString());
        });

        pio.stderr.on('data', (data) => {
            sendLog(buildId, data.toString());
        });

        pio.on('close', (code) => {
            if (code !== 0) {
                sendLog(buildId, `\nCompilation process exited with code ${code}`);
                // Очистка при ошибке
                fs.rmSync(workDir, { recursive: true, force: true });
                if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
                return res.status(500).send(`Compilation failed with code ${code}`);
            }

            sendLog(buildId, `\nCompilation finished successfully! Sending firmware...`);

            // 4. Ищем готовый .bin файл
            const binPath = path.join(workDir, '.pio', 'build', envName, 'firmware.bin');
            if (!fs.existsSync(binPath)) {
                return res.status(500).send('Firmware binary not found after compilation.');
            }

            // 5. Отправляем файл пользователю
            res.download(binPath, 'firmware.bin', (err) => {
                // 6. Очистка после отправки
                fs.rmSync(workDir, { recursive: true, force: true });
                if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
                sendLog(buildId, `Build workflow complete. Temporary files cleaned up.`);

                const ws = wsClients.get(buildId);
                if (ws) ws.close();
            });
        });

    } catch (error) {
        console.error('Compilation error:', error);
        sendLog(buildId, `Error: ${error.message}`);

        // Очистка при ошибке блока try-catch (например ошибка распаковки)
        if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
        if (zipPath && fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

        res.status(500).send(`Compilation failed: ${error.message}`);
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`PIO Compile Server (with WS) running on port ${PORT}`);
});
server.timeout = 600000; // 10 minutes timeout for long compilations
