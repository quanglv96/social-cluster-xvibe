const { ipcRenderer } = require('electron');

// ======================
// LOG
// ======================
const LOG_ICON = {
    info:  { icon: 'ℹ',  cls: 'log-info'  },
    warn:  { icon: '⚠',  cls: 'log-warn'  },
    error: { icon: '✖',  cls: 'log-error' },
    ok:    { icon: '✔',  cls: 'log-ok'    },
};

function appendLog({ type = 'info', msg = '' }) {
    const logEl = document.getElementById('log');
    const meta  = LOG_ICON[type] ?? LOG_ICON.info;

    let ts = '', body = msg;
    const tsMatch = msg.match(/^\[([^\]]+)\]\s*/);
    if (tsMatch) {
        ts   = tsMatch[1].slice(11, 19); // HH:mm:ss
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
window.start   = () => ipcRenderer.send("control", "start");
window.stop    = () => ipcRenderer.send("control", "stop");
window.restart = () => ipcRenderer.send("control", "restart");

window.save = () => {
    const host = document.getElementById("hostUrl").value;
    ipcRenderer.send("update-config", { host });
};

// ======================
// RECEIVE DATA
// ======================
ipcRenderer.on("log", (_, payload) => {
    if (typeof payload === 'string') return appendLog({ type: 'info', msg: payload });
    appendLog(payload);
});

ipcRenderer.on("stats", (_, data) => {
    document.getElementById("cpu").innerText    = data.cpu + "%";
    document.getElementById("memory").innerText = data.memory + " MB";
    document.getElementById("req").innerText    = data.requests;
    document.getElementById("error").innerText  = data.error;
});

// ======================
// STATUS
// ======================
ipcRenderer.on("status", (_, status) => {
    const dot  = document.getElementById("dot");
    const text = document.getElementById("status-text");

    text.innerText = status;

    if (status === 'RUNNING') {
        dot.classList.add('running');
    } else {
        dot.classList.remove('running');
    }
});

// ======================
// QUEUE
// ======================
const Q_META = {
    PENDING:    { icon: '⏳', cls: 'q-pending'    },
    PROCESSING: { icon: '⚡', cls: 'q-processing' },
    SUCCESS:    { icon: '✔',  cls: 'q-success'    },
    ERROR:      { icon: '✖',  cls: 'q-error'      },
};

ipcRenderer.on("queue", (_, items) => {
    const el = document.getElementById("queue");

    if (!items?.length) {
        el.innerHTML = `<div class="q-empty">No active tasks</div>`;
        return;
    }

    const incoming = new Set(items.map(i => `qi-${i.id}`));

    // Xóa q-empty nếu còn
    const empty = el.querySelector('.q-empty');
    if (empty) empty.remove();

    // Xóa row không còn trong danh sách
    [...el.children].forEach(child => {
        if (child.id && !incoming.has(child.id)) child.remove();
    });

    items.forEach(item => {
        const meta = Q_META[item.status] ?? Q_META.PENDING;
        const dur  = item.duration === null
            ? '-'
            : item.duration < 1000
                ? item.duration + 'ms'
                : (item.duration / 1000).toFixed(1) + 's';

        let row = document.getElementById(`qi-${item.id}`);

        if (!row) {
            row = document.createElement('div');
            row.id        = `qi-${item.id}`;
            row.className = 'queue-item';
            el.appendChild(row);
        }

        row.innerHTML = `
            <span class="q-badge q-status ${meta.cls}">${meta.icon} ${item.status}</span>
            <span class="q-action">${item.action}</span>
            <span class="q-id" title="${item.id}">${item.id.slice(-10)}</span>
            <span class="q-dur">${dur}</span>
        `;

        // Fade-out khi SUCCESS / ERROR, reset khi PENDING/PROCESSING
        if (item.status === 'SUCCESS' || item.status === 'ERROR') {
            row.style.transition = 'opacity 4.5s ease';
            requestAnimationFrame(() => { row.style.opacity = '0.25'; });
        } else {
            row.style.transition = 'none';
            row.style.opacity    = '1';
        }
    });
});

async function loadVersion() {
    const version = await ipcRenderer.invoke('get-version');
    document.getElementById('app-version').innerText = `v${version}`;
}

loadVersion();