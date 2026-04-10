const { ipcRenderer } = require('electron');

function appendLog(msg) {
    const log = document.getElementById('log');
    const div = document.createElement('div');
    div.textContent = msg;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
}

// ======================
// CONTROL
// ======================
window.start = () => ipcRenderer.send("control", "start");
window.stop = () => ipcRenderer.send("control", "stop");
window.restart = () => ipcRenderer.send("control", "restart");

window.save = () => {
    const rootUrl = document.getElementById("rootUrl").value;
    ipcRenderer.send("update-config", { rootUrl });
};

// ======================
// RECEIVE DATA
// ======================
ipcRenderer.on("log", (_, msg) => appendLog(msg));

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