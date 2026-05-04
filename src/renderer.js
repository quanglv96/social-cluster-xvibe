const {ipcRenderer} = require('electron');

// ======================
// LOG
// ======================
const LOG_ICON = {
    info: {icon: 'ℹ', cls: 'log-info'},
    warn: {icon: '⚠', cls: 'log-warn'},
    error: {icon: '✖', cls: 'log-error'},
    ok: {icon: '✔', cls: 'log-ok'},
};

function appendLog({type = 'info', msg = ''}) {
    const logEl = document.getElementById('log');
    const meta = LOG_ICON[type] ?? LOG_ICON.info;

    let ts = '', body = msg;
    const tsMatch = msg.match(/^\[([^\]]+)\]\s*/);
    if (tsMatch) {
        ts = tsMatch[1].slice(11, 19); // HH:mm:ss
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
    ipcRenderer.send("update-config", {host});
};

// ======================
// RECEIVE DATA
// ======================
ipcRenderer.on("log", (_, payload) => {
    if (typeof payload === 'string') return appendLog({type: 'info', msg: payload});
    appendLog(payload);
});

ipcRenderer.on("stats", (_, data) => {
    document.getElementById("cpu").innerText = data.cpu + "%";
    document.getElementById("memory").innerText = data.memory + " MB";
    document.getElementById("req").innerText = data.requests;
    document.getElementById("error").innerText = data.error;
});

// ======================
// STATUS
// ======================
ipcRenderer.on("status", (_, status) => {
    const dot = document.getElementById("dot");
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
    PENDING: {icon: '⏳', cls: 'q-pending'},
    PROCESSING: {icon: '⚡', cls: 'q-processing'},
    SUCCESS: {icon: '✔', cls: 'q-success'},
    ERROR: {icon: '✖', cls: 'q-error'},
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
        const dur = item.duration === null
            ? '-'
            : item.duration < 1000
                ? item.duration + 'ms'
                : (item.duration / 1000).toFixed(1) + 's';

        let row = document.getElementById(`qi-${item.id}`);

        if (!row) {
            row = document.createElement('div');
            row.id = `qi-${item.id}`;
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
            requestAnimationFrame(() => {
                row.style.opacity = '0.25';
            });
        } else {
            row.style.transition = 'none';
            row.style.opacity = '1';
        }
    });
});

async function loadVersion() {
    const version = await ipcRenderer.invoke('get-version');
    document.getElementById('app-version').innerText = `v${version}`;
}

loadVersion();


// ===========UPDATE HEADLESS READTIME=============
// HEADLESS=true  = browser đang ẩn  = button "HIDDEN" (đỏ)
// HEADLESS=false = browser đang hiện = button "VISIBLE" (xanh)
let HEADLESS = true; // sync với BrowserManager default

async function initHeadless() {
    HEADLESS = await ipcRenderer.invoke('get-headless');
    updateHeadlessUI();
}

window.toggleHeadless = function () {
    HEADLESS = !HEADLESS;
    ipcRenderer.send('set-headless', HEADLESS);
    updateHeadlessUI();
};

function updateHeadlessUI() {
    const btn = document.getElementById('btn-headless');
    const state = document.getElementById('headless-state');

    if (HEADLESS) {
        // Đang ẩn browser
        state.innerText = 'HIDDEN';
        btn.classList.remove('btn-headless-on');
        btn.classList.add('btn-headless-off');
    } else {
        // Đang hiện browser
        state.innerText = 'VISIBLE';
        btn.classList.remove('btn-headless-off');
        btn.classList.add('btn-headless-on');
    }
}

// ======================
// PROFILES
// ======================
ipcRenderer.on('profiles', (_, profiles) => {
    const el = document.getElementById('profiles');
    if (!el) return;

    if (!profiles?.length) {
        el.innerHTML = `<div class="p-empty">No profiles found</div>`;
        return;
    }

    el.innerHTML = profiles.map(p => `
    <div class="profile-item">
        <span class="profile-name" title="${p.profilePath}">
            [${p.type}] ${p.name}
        </span>
        <button class="profile-open"
            onclick="openProfile('${p.profilePath.replace(/\\/g, '\\\\')}', '${p.type}')">
            ▶ Open
        </button>
    </div>
`).join('');
});

window.openProfile = function (profilePath, type) {
    ipcRenderer.send('open-profile', {profilePath, type});
};

window.refreshProfiles = function () {
    ipcRenderer.send('get-profiles');
};

// Load profiles khi khởi động
ipcRenderer.send('get-profiles');

// ======================
// UPDATER UI
// ======================
ipcRenderer.on('updater', (_, payload) => {
    const { event, version, percent, kbps, transferred, total } = payload;

    let badge = document.getElementById('update-badge');

    // Helper tạo badge nếu chưa có
    function ensureBadge() {
        if (badge) return badge;
        badge = document.createElement('div');
        badge.id = 'update-badge';
        badge.style.cssText = `
            position: fixed; bottom: 16px; right: 16px;
            font-family: var(--mono); font-size: 11px;
            padding: 10px 16px; border-radius: 6px;
            z-index: 9999; cursor: pointer; letter-spacing: .06em;
            border: 1px solid; transition: all .2s;
        `;
        document.body.appendChild(badge);
        return badge;
    }

    if (event === 'checking') {
        // Không hiện badge, chỉ log (đã có log từ main)
        return;
    }

    if (event === 'available') {
        const b = ensureBadge();
        b.style.background = 'var(--accent-dim)';
        b.style.borderColor = 'var(--accent)';
        b.style.color = 'var(--accent)';
        b.innerText = `🆕 v${version} available — click to download`;
        b.onclick = () => ipcRenderer.send('check-for-updates');
    }

    if (event === 'downloading') {
        const b = ensureBadge();
        b.style.background = '#1a1500';
        b.style.borderColor = 'var(--amber)';
        b.style.color = 'var(--amber)';
        b.style.cursor = 'default';
        b.onclick = null;

        const pct = percent ?? 0;
        if (transferred && total) {
            b.innerText = `⬇️ ${pct}% — ${transferred}/${total} MB @ ${kbps} KB/s`;
        } else {
            b.innerText = `⬇️ Downloading... ${pct}%`;
        }
    }

    if (event === 'downloaded') {
        const b = ensureBadge();
        b.style.background = 'var(--green-dim)';
        b.style.borderColor = 'var(--green)';
        b.style.color = 'var(--green)';
        b.style.cursor = 'pointer';
        b.innerText = `✅ v${version} ready — click to restart`;
        b.onclick = () => ipcRenderer.send('install-update');
    }

    if (event === 'error' || event === 'idle') {
        if (badge) badge.remove();
    }
});


initHeadless();