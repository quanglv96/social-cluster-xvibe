import fs from 'fs';
import path from 'path';
import axios from 'axios';

const CLOUDFLARED_URL =
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";

export async function ensureCloudflared(exePath) {

    if (fs.existsSync(exePath)) {
        return exePath;
    }

    fs.mkdirSync(path.dirname(exePath), { recursive: true });

    const writer = fs.createWriteStream(exePath);

    const response = await axios({
        url: CLOUDFLARED_URL,
        method: 'GET',
        responseType: 'stream',
        maxRedirects: 5
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {

        writer.on('finish', () => resolve(exePath));
        writer.on('error', reject);

    });
}