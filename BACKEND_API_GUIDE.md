# PlatformIO Compilation Backend: API & Integration Guide

This document is intended for AI agents and developers working on the frontend. It describes how to interact with the PlatformIO compilation backend.

## 🚀 Backend Overview
The backend is a Node.js Express service that receives a ZIP archive containing a PlatformIO project, compiles it using PlatformIO Core, and returns the resulting `firmware.bin` file.

*   **Host**: `pio.mpcbchat.ru`
*   **Port**: `4443` (HTTPS/WSS)
*   **Base URL**: `https://pio.mpcbchat.ru:4443`

---

## 🛠 API Endpoints

### 1. Compile Project (POST `/compile`)
This endpoint accepts a ZIP file and triggers the compilation process.

*   **URL**: `https://pio.mpcbchat.ru:4443/compile`
*   **Method**: `POST`
*   **Content-Type**: `multipart/form-data`
*   **Body Parameters**:
    *   `projectZip` (File): A ZIP archive containing `platformio.ini` and `src/main.cpp`.
    *   `board` (String, optional): The PlatformIO environment name (e.g., `esp32-c3-devkitm-1`). Defaults to `esp32-c3-devkitm-1`.
    *   `buildId` (String, optional): A unique ID for this build (e.g., `build_1709736000`). Used to connect to the WebSocket log stream.

**Response**:
*   Returns the `firmware.bin` file as a download on success.
*   Returns `500 Internal Server Error` with an error message on failure.

---

### 2. Live Compilation Logs (WebSocket)
To receive real-time logs from the `pio run` command, connect to the WebSocket server **before** or **immediately after** sending the POST request.

*   **URL**: `wss://pio.mpcbchat.ru:4443/?buildId=YOUR_BUILD_ID`
*   **Protocol**: `WSS`

**Message Format**:
```json
{
  "type": "log",
  "data": "Processing esp32-c3-devkitm-1 (platform: espressif32; board: ...)"
}
```

---

## 🛡 Security & Safeguards
The backend is hardened with several layers of protection:
1.  **SSL/TLS**: All traffic is encrypted via Let's Encrypt (Nginx on port 4443).
2.  **Rate Limiting**: 
    *   Max **1 request per second** per IP (average).
    *   Burst capacity: up to 5 requests.
    *   Exceeding this results in `503 Service Unavailable`.
3.  **Connection Limiting**: Max **2 concurrent connections** per IP.
4.  **Auto-Cleanup**: Temporary build directories and uploaded ZIPs are deleted immediately after the response is sent or if an error occurs.
5.  **Fail2Ban**: Malicious activity (brute force or high-volume 404s) results in a 1-hour IP ban.

---

## 💻 Frontend Implementation Snippet (Example)

```javascript
async function compileProject(zipBlob, boardName) {
    const buildId = `build_${Date.now()}`;
    const formData = new FormData();
    formData.append('projectZip', zipBlob, 'project.zip');
    formData.append('board', boardName);
    formData.append('buildId', buildId);

    // 1. Setup WebSocket for logs
    const ws = new WebSocket(`wss://pio.mpcbchat.ru:4443/?buildId=${buildId}`);
    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'log') console.log(msg.data);
    };

    // 2. Send request
    const response = await fetch('https://pio.mpcbchat.ru:4443/compile', {
        method: 'POST',
        body: formData
    });

    if (response.ok) {
        const binBlob = await response.blob();
        // Handle downloaded firmware.bin
    } else {
        console.error('Compilation failed');
    }
}
```

---

## 📂 Server Architecture (Internal)
*   **Process Manager**: PM2 (`pio-backend`)
*   **Runtime**: Node.js 20 (via NVM)
*   **Compiler**: PlatformIO Core 6.1.19
*   **Reverse Proxy**: Nginx (Listening on 4443, proxying to 3000)
*   **Workspace**: Temporary projects are extracted to `./builds/build_ID/`.
