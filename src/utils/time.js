// src/utils/time.js
export function nowIso() {
    return new Date().toLocaleString('sv-SE', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour12: false,
    }).replace(' ', 'T') + '+07:00';
}