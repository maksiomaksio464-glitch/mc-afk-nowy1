const mineflayer = require('mineflayer');
const https = require('https');
const http = require('http');
const url = require('url');
const cron = require('node-cron');

const NTFY_TOPIC = 'moj-aternos-12033';
let botInstance = null;
let isConnecting = false;
let jumpInterval = null;
let isJumpingEnabled = true;
let jumpDelay = 5000; // Domyślnie skok co 5 sekund

// Lista aktywnych zadań w harmonogramie
let schedules = []; // { id, type: 'routine'|'once', time: 'HH:MM', action: 'connect'|'quit', cronTask, timeoutId }

function sanitizeHeader(text) {
  return text
    .replace(/Ł/g, 'L').replace(/ł/g, 'l')
    .replace(/Ś/g, 'S').replace(/ś/g, 's')
    .replace(/Ć/g, 'C').replace(/ć/g, 'c')
    .replace(/Ą/g, 'A').replace(/ą/g, 'a')
    .replace(/Ę/g, 'E').replace(/ę/g, 'e')
    .replace(/Ż/g, 'Z').replace(/ż/g, 'z')
    .replace(/Ź/g, 'Z').replace(/ź/g, 'z')
    .replace(/Ń/g, 'N').replace(/ń/g, 'n')
    .replace(/Ó/g, 'O').replace(/ó/g, 'o');
}

function sendPhoneAlert(title, message) {
  const req = https.request(`https://ntfy.sh/${NTFY_TOPIC}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Title': sanitizeHeader(title),
      'Priority': 'high'
    }
  });

  req.on('error', (err) => console.log('Błąd wysyłania alertu:', err.message));
  req.write(message);
  req.end();
}

function startJumping(bot) {
  if (jumpInterval) clearInterval(jumpInterval);
  jumpInterval = setInterval(() => {
    if (bot && bot.entity && isJumpingEnabled) {
      bot.setControlState('jump', true);
      setTimeout(() => {
        if (bot) bot.setControlState('jump', false);
      }, 400);
    }
  }, jumpDelay);
}

function digBlock(bot) {
  if (!bot) return;
  const target = bot.blockAtCursor(4);
  if (!target) {
    console.log('Brak bloku w zasięgu!');
    return;
  }
  bot.dig(target, (err) => {
    if (err) console.log('Błąd podczas kopania:', err.message);
    else console.log(`Wykopano blok: ${target.name}`);
  });
}

function createBot() {
  if (isConnecting || botInstance) return;
  isConnecting = true;

  console.log('Łączenie bota z serwerem...');

  const bot = mineflayer.createBot({
    host: 'gramyreazemLdd.aternos.me',
    port: 12033,
    username: 'Maksioreks_afk',
    version: '1.21.10'
  });

  botInstance = bot;

  bot.on('spawn', () => {
    isConnecting = false;
    console.log('Bot wszedł na serwer!');
    sendPhoneAlert('Aternos: Bot Polaczony', 'Bot wszedl na serwer i rozpoczal skakanie.');

    setTimeout(() => {
      if (botInstance) botInstance.chat('/survival');
    }, 2000);

    startJumping(botInstance);
  });

  bot.on('respawn', () => {
    console.log('Zmiana świata lub przeniesienie na inny serwer!');
    sendPhoneAlert('Aternos: Przeniesienie', 'Bot zmienil wymiar, swiat lub zostal przeniesiony na inny sub-serwer.');
  });

  bot.on('kicked', (reason) => {
    let parsedReason = typeof reason === 'object' ? JSON.stringify(reason) : reason;
    if (parsedReason.includes('duplicate_login')) {
      parsedReason = 'Podwójne logowanie (bot już był na serwerze)';
    }
    console.log('Bot wyrzucony/zabanowany:', parsedReason);
    sendPhoneAlert('Aternos: Bot Wyrzucony/Ban', `Powod: ${parsedReason}`);
  });

  bot.on('end', (reason) => {
    console.log('Połączenie zerwane:', reason);
    if (jumpInterval) clearInterval(jumpInterval);
    botInstance = null;
    sendPhoneAlert('Aternos: Serwer Offline', `Serwer zostal wylaczony lub zerwano polaczenie! (Powod: ${reason})`);
    
    setTimeout(() => {
      isConnecting = false;
      createBot();
    }, 30000);
  });

  bot.on('error', (err) => {
    console.log('Błąd bota:', err.message);
    if (!err.message.includes('ECONNREFUSED') && !err.message.includes('protocol version')) {
      sendPhoneAlert('Aternos: Blad Polaczenia', `Blad: ${err.message}`);
    }
  });

  bot.on('death', () => {
    console.log('Bot zginął!');
    sendPhoneAlert('Aternos: Smierc Bota', 'Bot zginal na serwerze i wykonuje respawn.');
    bot.respawn();
  });
}

function disconnectBot() {
  if (botInstance) {
    botInstance.quit();
    botInstance = null;
    if (jumpInterval) clearInterval(jumpInterval);
  }
}

// ---------------- OBSŁUGA HARMONOGRAMU ----------------
function executeScheduleAction(action) {
  if (action === 'connect') {
    if (!botInstance) createBot();
  } else if (action === 'quit') {
    disconnectBot();
  }
}

function addSchedule(type, time, action) {
  const [hour, minute] = time.split(':');
  const id = Date.now().toString();

  if (type === 'routine') {
    const cronExp = `${minute} ${hour} * * *`;
    const task = cron.schedule(cronExp, () => {
      console.log(`[HARMONOGRAM] Wykonywanie rutyny: ${action} o ${time}`);
      executeScheduleAction(action);
    });
    schedules.push({ id, type, time, action, cronTask: task });
  } else if (type === 'once') {
    const now = new Date();
    const target = new Date();
    target.setHours(parseInt(hour, 10), parseInt(minute, 10), 0, 0);

    if (target <= now) {
      target.setDate(target.getDate() + 1); // Jeśli czas minął dzisiaj, ustaw na jutro
    }

    const delay = target.getTime() - now.getTime();
    const timeoutId = setTimeout(() => {
      console.log(`[HARMONOGRAM] Wykonywanie akcji jednorazowej: ${action} o ${time}`);
      executeScheduleAction(action);
      removeSchedule(id);
    }, delay);

    schedules.push({ id, type, time, action, timeoutId });
  }
}

function removeSchedule(id) {
  const index = schedules.findIndex(s => s.id === id);
  if (index !== -1) {
    const sched = schedules[index];
    if (sched.cronTask) sched.cronTask.stop();
    if (sched.timeoutId) clearTimeout(sched.timeoutId);
    schedules.splice(index, 1);
  }
}

// ---------------- PANEL HTTP / WWW ----------------
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  const reqUrl = url.parse(req.url, true);

  if (reqUrl.pathname === '/api/control') {
    const action = reqUrl.query.action;
    const value = reqUrl.query.value;

    if (action === 'add_schedule') {
      const type = reqUrl.query.type; // 'once' lub 'routine'
      const time = reqUrl.query.time; // 'HH:MM'
      const schedAction = reqUrl.query.schedAction; // 'connect' lub 'quit'
      if (type && time && schedAction) {
        addSchedule(type, time, schedAction);
      }
    } else if (action === 'remove_schedule') {
      if (value) removeSchedule(value);
    } else if (!botInstance && action !== 'connect') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'error', message: 'Bot nie jest połączony!' }));
    } else {
      switch (action) {
        case 'quit':
          disconnectBot();
          break;

        case 'connect':
          if (!botInstance) createBot();
          break;

        case 'chat':
          if (value) botInstance.chat(value);
          break;

        case 'move':
          if (value) {
            botInstance.setControlState(value, true);
            setTimeout(() => {
              if (botInstance) botInstance.setControlState(value, false);
            }, 1000);
          }
          break;

        case 'toggle_jump':
          isJumpingEnabled = !isJumpingEnabled;
          break;

        case 'set_jump_delay':
          if (value) {
            jumpDelay = parseInt(value, 10) * 1000;
            if (botInstance) startJumping(botInstance);
          }
          break;

        case 'camera':
          if (value && botInstance) {
            let yaw = botInstance.entity.yaw;
            let pitch = botInstance.entity.pitch;
            if (value === 'left') yaw += 0.5;
            if (value === 'right') yaw -= 0.5;
            if (value === 'up') pitch = Math.max(-Math.PI / 2, pitch - 0.3);
            if (value === 'down') pitch = Math.min(Math.PI / 2, pitch + 0.3);
            botInstance.look(yaw, pitch, true);
          }
          break;

        case 'dig':
          if (botInstance) digBlock(botInstance);
          break;
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ 
      status: 'ok', 
      isOnline: !!botInstance, 
      jumping: isJumpingEnabled,
      delay: jumpDelay / 1000 
    }));
  }

  // Generowanie listy zadań HTML
  const scheduleRows = schedules.map(s => `
    <li style="margin-bottom: 8px; text-align: left; background: #2a2a2a; padding: 6px 10px; border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
      <span>
        <b>${s.time}</b> - ${s.action === 'connect' ? 'Wejście' : 'Wyjście'} 
        <small>(${s.type === 'routine' ? 'Codziennie' : 'Jednorazowo'})</small>
      </span>
      <button class="danger" style="padding: 2px 8px; margin: 0;" onclick="send('remove_schedule', '${s.id}')">X</button>
    </li>
  `).join('');

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`
    <!DOCTYPE html>
    <html lang="pl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Panel Bota Maksioreks_afk</title>
      <style>
        body { font-family: Arial, sans-serif; background: #121212; color: #fff; text-align: center; padding: 20px; }
        .card { background: #1e1e1e; max-width: 450px; margin: 0 auto; padding: 20px; border-radius: 12px; box-shadow: 0 4px 10px rgba(0,0,0,0.5); }
        button { background: #007bff; color: white; border: none; padding: 10px 15px; margin: 5px; border-radius: 6px; cursor: pointer; font-size: 14px; }
        button:hover { background: #0056b3; }
        button.danger { background: #dc3545; }
        button.danger:hover { background: #a71d2a; }
        button.success { background: #28a745; }
        button.success:hover { background: #1e7e34; }
        input[type="text"], input[type="time"], select { padding: 8px; border-radius: 6px; border: 1px solid #444; background: #222; color: white; margin: 3px; }
        .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; max-width: 220px; margin: 15px auto; }
        .status { font-weight: bold; padding: 8px; border-radius: 4px; display: inline-block; margin-bottom: 15px; }
        .online { background: #28a745; }
        .offline { background: #dc3545; }
        .slider-container { margin: 15px 0; }
        ul { list-style: none; padding: 0; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>Panel Bota MC</h2>
        <div class="status ${botInstance ? 'online' : 'offline'}">
          Status: ${botInstance ? 'POŁĄCZONY' : 'ROZŁĄCZONY'}
        </div>
        
        <div>
          <button class="success" onclick="send('connect')">Wejdź na serwer</button>
          <button class="danger" onclick="send('quit')">Wyjdź z serwera</button>
        </div>

        <hr style="border-color: #333; margin: 20px 0;">

        <h3>Harmonogram (Schedule)</h3>
        <div style="margin-bottom: 15px;">
          <input type="time" id="schedTime" required>
          <select id="schedAction">
            <option value="connect">Wejdź</option>
            <option value="quit">Wyjdź</option>
          </select>
          <select id="schedType">
            <option value="once">Jednorazowo</option>
            <option value="routine">Rutyna (Codziennie)</option>
          </select>
          <br>
          <button class="success" onclick="addSchedule()">Dodaj zadanie</button>
        </div>
        <ul>${scheduleRows || '<li style="color:#888;">Brak zaplanowanych zadań</li>'}</ul>

        <hr style="border-color: #333; margin: 20px 0;">

        <h3>Ruch bota</h3>
        <div class="grid">
          <div></div>
          <button onclick="send('move', 'forward')">▲ Przód</button>
          <div></div>
          <button onclick="send('move', 'left')">◄ Lewo</button>
          <button onclick="send('move', 'jump')">Skok</button>
          <button onclick="send('move', 'right')">Prawo ►</button>
          <div></div>
          <button onclick="send('move', 'back')">▼ Tył</button>
          <div></div>
        </div>

        <hr style="border-color: #333; margin: 20px 0;">

        <h3>Kamera (Kierunek patrzenia)</h3>
        <div class="grid">
          <div></div>
          <button onclick="send('camera', 'up')">Góra ▲</button>
          <div></div>
          <button onclick="send('camera', 'left')">◄ Lewo</button>
          <div></div>
          <button onclick="send('camera', 'right')">Prawo ►</button>
          <div></div>
          <button onclick="send('camera', 'down')">Dół ▼</button>
          <div></div>
        </div>

        <hr style="border-color: #333; margin: 20px 0;">

        <h3>Wykopywanie bloków</h3>
        <button class="danger" onclick="send('dig')">⛏️ Wykop blok przed sobą</button>

        <hr style="border-color: #333; margin: 20px 0;">

        <h3>Ustawienia Skakania</h3>
        <button onclick="send('toggle_jump')">Włącz/Wyłącz Auto-Skakanie</button>
        <div class="slider-container">
          <label>Odstęp skoków: <span id="delayVal">${jumpDelay / 1000}</span>s</label><br>
          <input type="range" min="1" max="10" value="${jumpDelay / 1000}" onchange="updateDelay(this.value)">
        </div>

        <hr style="border-color: #333; margin: 20px 0;">

        <h3>Wiadomość / Komenda</h3>
        <input type="text" id="chatInput" placeholder="/survival lub cześć...">
        <button onclick="sendChat()">Wyślij</button>
      </div>

      <script>
        function send(action, value = '') {
          fetch('/api/control?action=' + action + '&value=' + value)
            .then(res => res.json())
            .then(data => {
              if (data.delay) document.getElementById('delayVal').innerText = data.delay;
              setTimeout(() => location.reload(), 300);
            });
        }

        function addSchedule() {
          const time = document.getElementById('schedTime').value;
          const schedAction = document.getElementById('schedAction').value;
          const type = document.getElementById('schedType').value;
          if (!time) return alert('Wybierz godzinę!');

          fetch(\`/api/control?action=add_schedule&type=\${type}&time=\${time}&schedAction=\${schedAction}\`)
            .then(() => setTimeout(() => location.reload(), 300));
        }

        function updateDelay(val) {
          document.getElementById('delayVal').innerText = val;
          send('set_jump_delay', val);
        }

        function sendChat() {
          const val = document.getElementById('chatInput').value;
          if (val) send('chat', encodeURIComponent(val));
        }
      </script>
    </body>
    </html>
  `);
}).listen(PORT, () => {
  console.log(`Serwer HTTP uruchomiony na porcie ${PORT}`);
});

createBot();
