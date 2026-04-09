import { spawn } from 'child_process';

export class TunnelService {

    static process = null;
    static url = null;

    static async start(port) {
        if (this.url) {
            console.log('♻️  Reuse tunnel:', this.url);
            return this.url;
        }

        console.log(`🌐 Đang mở SSH tunnel qua serveo.net cho port ${port}...`);

        return new Promise((resolve, reject) => {
            const proc = spawn('ssh', [
                '-o', 'StrictHostKeyChecking=no',
                '-o', 'ServerAliveInterval=30',
                '-o', 'ServerAliveCountMax=3',
                '-o', 'ExitOnForwardFailure=yes',
                '-R', `80:localhost:${port}`,
                'serveo.net'
            ], { stdio: ['ignore', 'pipe', 'pipe'] });

            this.process = proc;

            const timer = setTimeout(() => {
                proc.kill();
                reject(new Error('Tunnel timeout sau 30s — kiểm tra SSH có sẵn không'));
            }, 30000);

            const onData = (data) => {
                const text = data.toString();

                // in log gọn
                text.split('\n')
                    .map(l => l.trim())
                    .filter(Boolean)
                    .forEach(l => console.log('[serveo]', l));

                const match = text.match(/https:\/\/[a-z0-9\-]+\.serveousercontent\.com/);
                if (match) {
                    clearTimeout(timer);
                    this.url = match[0];

                    console.log('');
                    console.log('╔══════════════════════════════════════════════╗');
                    console.log('║  🌍  TUNNEL SẴN SÀNG (serveo)              ║');
                    console.log('╚══════════════════════════════════════════════╝');
                    console.log(`   ${this.url}`);
                    console.log('');

                    resolve(this.url);
                }
            };

            proc.stdout.on('data', onData);
            proc.stderr.on('data', onData);

            proc.on('error', (err) => {
                clearTimeout(timer);
                if (err.code === 'ENOENT') {
                    reject(new Error('ssh không tìm thấy — cài openssh-client trước'));
                } else {
                    reject(err);
                }
            });

            proc.on('close', (code) => {
                clearTimeout(timer);
                console.warn('⚠️  Tunnel đã đóng, code:', code);
                this.url = null;
                this.process = null;

                // tự reconnect nếu đã resolve rồi (tunnel bị drop giữa chừng)
                if (this.url === null && code !== 0) {
                    console.log('🔁 Đang thử reconnect tunnel...');
                    setTimeout(() => TunnelService.start(port), 3000);
                }
            });
        });
    }

    static async stop() {
        if (this.process) {
            this.process.kill();
            this.process = null;
            this.url = null;
            console.log('🛑 Tunnel stopped');
        }
    }
}