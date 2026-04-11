const { ipcRenderer } = require('electron');
const LOG_ICON = {
    info:  { icon: 'ℹ',  cls: 'log-info'  },
    warn:  { icon: '⚠',  cls: 'log-warn'  },
    error: { icon: '✖',  cls: 'log-error' },
    ok:    { icon: '✔',  cls: 'log-ok'    },
};
function appendLog({ type = 'info', msg = '' }) {
    const logEl = document.getElementById('log');
    const meta  = LOG_ICON[type] ?? LOG_ICON.info;

    // parse timestamp ra nếu có — format: [2024-...Z]
    let ts = '', body = msg;
    const tsMatch = msg.match(/^\[([^\]]+)\]\s*/);
    if (tsMatch) {
        ts   = tsMatch[1].slice(11, 19); // chỉ lấy HH:mm:ss
        body = msg.slice(tsMatch[0].length);
    }

    const line = document.createElement('div');
    line.className = `log-line ${meta.cls}`;
    line.innerHTML = `
        <span class="log-icon">${meta.icon}</span>
        <span class="log-ts">${ts}</span>
        <span class="log-msg">${body}</span>
    `;

    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
}

// ======================
// CONTROL
// ======================
window.start = () => ipcRenderer.send("control", "start");
window.stop = () => ipcRenderer.send("control", "stop");
window.restart = () => ipcRenderer.send("control", "restart");

window.save = () => {
    const host = document.getElementById("hostUrl").value;
    ipcRenderer.send("update-config", { host });
};

// ======================
// RECEIVE DATA
// ======================
ipcRenderer.on("log", (_, payload) => {
    // backward-compat: nếu main cũ vẫn gửi string thuần
    if (typeof payload === 'string') return appendLog({ type: 'info', msg: payload });
    appendLog(payload);
});

ipcRenderer.on("stats", (_, data) => {
    document.getElementById("cpu").innerText = data.cpu + "%";
    document.getElementById("memory").innerText = data.memory + " MB";
    document.getElementById("req").innerText = data.requests;
    document.getElementById("error").innerText = data.error;
});

ipcRenderer.on("queue", (_, queue) => {
    const el = document.getElementById("queue");
    el.innerHTML = "";

    queue.forEach(item => {
        const div = document.createElement("div");
        div.className = "queue-item";

        div.textContent =
            `${item.id} | ${item.url || ''} | ${item.duration}ms`;

        el.appendChild(div);
    });
});

ipcRenderer.on("status", (_, status) => {
    document.getElementById("status").innerText = status;
});